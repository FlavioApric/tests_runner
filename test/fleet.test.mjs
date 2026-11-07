// End-to-end against a fake GitHub that also plays the App: discovery -> provision -> per-run secrets -> dispatch ->
// watch -> collect -> infra retry -> sealed bundle -> pull on the PC.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { generateKeys, sealFile } from '../lib/crypto.mjs'
import * as fleet from '../lib/fleet.mjs'
import { coordinate } from '../lib/coordinator.mjs'
import { appJwt, githubApp, discoverRunners } from '../lib/app.mjs'
import { provision, stubYaml, STUB_PATH } from '../lib/provision.mjs'
import * as local from '../lib/local.mjs'
import { makeZip } from './helpers.mjs'

const TAR = process.platform === 'win32' && fs.existsSync('C:\\Windows\\System32\\tar.exe') ? 'C:\\Windows\\System32\\tar.exe' : 'tar'
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qaf-e2e-'))
const SHA = 'a'.repeat(40)
const HOME = 'me/tests_runner'
const UNITS = { schema: 'qa-fleet/units@1', units: [
  { id: 'ok-1', cmd: 'true', estMinutes: 3, secrets: ['STRIPE_TEST_KEY'] }, { id: 'ok-2', cmd: 'true', estMinutes: 3 }, { id: 'red', cmd: 'false', estMinutes: 2 }, { id: 'flaky-infra', cmd: 'true', estMinutes: 1 },
  { id: 'explore-x', agent: { charter: 'c.md' } },
] }
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' })

function project() {
  const p = tmp()
  fs.mkdirSync(path.join(p, '.qa-fleet'))
  fs.writeFileSync(path.join(p, '.qa-fleet', 'units.json'), JSON.stringify(UNITS))
  return p
}

async function artifactZip(recipient, unit, exitCode, phase, junit) {
  const d = tmp(), stage = path.join(d, 'stage')
  fs.mkdirSync(path.join(stage, 'qa-fleet-meta'), { recursive: true }); fs.mkdirSync(path.join(stage, 'results'), { recursive: true })
  fs.writeFileSync(path.join(stage, 'qa-fleet-meta', 'result.json'), JSON.stringify({ unit, phase, exitCode, durationSec: 125, sha: 'abc', runner: 'x' }))
  fs.writeFileSync(path.join(stage, 'qa-fleet-meta', 'unit.log'), 'private log: user@example.com\n')
  if (junit) fs.writeFileSync(path.join(stage, 'results', 'junit.xml'), junit)
  const t = spawnSync(TAR, ['-czf', 'res.tgz', '-C', 'stage', '.'], { cwd: d, encoding: 'utf8' })
  assert.equal(t.status, 0, t.stderr)
  await sealFile(path.join(d, 'res.tgz'), path.join(d, 'res.qaf'), recipient)
  return makeZip([['res.qaf', fs.readFileSync(path.join(d, 'res.qaf'))]])
}

const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const verifyJwt = (auth) => {
  const [h, b, s] = auth.replace(/^Bearer /, '').split('.')
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, 'base64url')), 'App JWT signed with the App key')
  const p = JSON.parse(Buffer.from(b, 'base64url'))
  assert.equal(p.iss, '123'); assert.ok(p.exp - p.iat <= 600)
}

// installations: 1 = org1, 2 = org2, 3 = a stranger, 9 = the home owner (home repo + private source)
const INSTALLS = [
  { id: 9, account: { login: 'me' }, repos: [{ name: 'tests_runner', full_name: HOME }, { name: 'app', full_name: 'me/app', private: true }] },
  { id: 1, account: { login: 'org1' }, repos: [{ name: 'tests_runner', full_name: 'org1/tests_runner' }] },
  { id: 2, account: { login: 'org2' }, repos: [{ name: 'tests_runner_O', full_name: 'org2/tests_runner_O' }, { name: 'blog', full_name: 'org2/blog' }] },
  { id: 3, account: { login: 'stranger' }, repos: [{ name: 'tests_runner', full_name: 'stranger/tests_runner' }] },
]
const tokenFor = (inst, narrow) => `tok-${inst}-${(narrow.repositories ?? ['all']).join('+')}${narrow.permissions ? '-' + Object.entries(narrow.permissions).map((x) => x.join(':')).join('') : ''}`

function fakeGitHub(recipient) {
  const calls = { dispatch: [], minted: [], files: {}, puts: 0, touched: new Set() }
  const runs = new Map(), arts = new Map()
  let nextRun = 100, nextArt = 1
  const unitsJson = Buffer.from(JSON.stringify(UNITS))
  async function fetchImpl(url, init = {}) {
    const u = new URL(url), p = u.pathname, auth = init.headers.Authorization ?? ''
    if (p === '/app/installations') { verifyJwt(auth); return J(INSTALLS.map(({ repos, ...i }) => i)) }
    let m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(p)
    if (m) { verifyJwt(auth); const narrow = JSON.parse(init.body ?? '{}'); const token = tokenFor(m[1], narrow); calls.minted.push({ inst: m[1], narrow, token }); return J({ token, expires_at: new Date(Date.now() + 3600e3).toISOString() }, 201) }
    if (p === '/installation/repositories') { const inst = INSTALLS.find((i) => auth === `Bearer ${tokenFor(i.id, {})}`); assert.ok(inst, 'listing repos with an installation token'); return J({ repositories: inst.repos }) }
    if (p === '/repos/me/app/installation') { verifyJwt(auth); return J({ id: 9 }) }
    m = /^\/repos\/([^/]+\/[^/]+)(.*)$/.exec(p)
    assert.ok(m, url)
    const [, repo, rest] = m
    calls.touched.add(repo)
    if (repo === 'me/app') {
      assert.equal(auth, `Bearer ${tokenFor(9, { repositories: ['app'], permissions: { contents: 'read' } })}`, 'the source is read with the narrowed read-only token')
      if (rest === '/contents/.qa-fleet/units.json') return J({ content: unitsJson.toString('base64'), encoding: 'base64' })
      return J({ message: 'Not Found' }, 404)
    }
    const inst = INSTALLS.find((i) => i.repos.some((r) => r.full_name === repo))
    assert.equal(auth, `Bearer ${tokenFor(inst.id, { repositories: [repo.split('/')[1]] })}`, `${repo} is reached with a token narrowed to that repo`)
    if (rest === '') return J({ private: false })
    if (rest === `/contents/${STUB_PATH}`) {
      if (init.method === 'PUT') { calls.puts++; const b = JSON.parse(init.body); calls.files[repo] = { sha: `s${calls.puts}`, text: Buffer.from(b.content, 'base64').toString('utf8') }; return J({}, 201) }
      const f = calls.files[repo]; return f ? J({ sha: f.sha, content: Buffer.from(f.text).toString('base64') }) : J({ message: 'This repository is empty.' }, 404)
    }
    if (rest === '/actions/permissions') return new Response(null, { status: 204 })
    if (rest === '/actions/runs' && u.searchParams.get('status')) return J({ workflow_runs: [] })
    if (rest === '/actions/workflows/shard.yml/dispatches') {
      const body = JSON.parse(init.body)
      calls.dispatch.push({ repo, ...body.inputs })
      const id = nextRun++
      runs.set(id, { repo, units: body.inputs.units.split(','), batch: body.inputs.batch, runId: body.inputs.run_id })
      return J({ workflow_run_id: id })
    }
    let r = /^\/actions\/runs\/(\d+)(\/jobs|\/artifacts|\/cancel)?$/.exec(rest)
    if (r) {
      const run = runs.get(Number(r[1]))
      if (!r[2]) return J({ id: Number(r[1]), status: 'completed' })
      const lost = (x) => x === 'flaky-infra' && run.batch.startsWith('b-')
      if (r[2] === '/jobs') return J({ jobs: [{ name: 'shard / validate', status: 'completed' }, ...run.units.map((x) => ({ name: `shard / u:${x}`, status: 'completed', started_at: '2026-01-01T10:00:00Z', completed_at: '2026-01-01T10:04:00Z', conclusion: x === 'red' || lost(x) ? 'failure' : 'success', steps: x === 'red' ? [{ name: 'Result', conclusion: 'failure' }] : lost(x) ? [{ name: 'Infra failure', conclusion: 'failure' }, { name: 'Result', conclusion: 'failure' }] : [] }))] })
      const list = []
      for (const x of run.units) {
        if (lost(x)) continue
        const id = nextArt++
        const junit = x === 'red' ? '<testsuite tests="2"><testcase name="a"/><testcase name="b"><failure/></testcase></testsuite>' : '<testsuite tests="1"><testcase name="a"/></testcase></testsuite>'.replace('</testcase></testsuite>', '</testsuite>')
        arts.set(id, artifactZip(recipient, x, x === 'red' ? 1 : 0, 'run', junit))
        list.push({ id, name: `res-${run.runId}-${x}`, expired: false })
      }
      return J({ artifacts: list })
    }
    r = /^\/actions\/artifacts\/(\d+)\/zip$/.exec(rest)
    if (r) return new Response(await arts.get(Number(r[1])), { status: 200 })
    return J({ message: `not faked: ${init.method} ${rest}` }, 404)
  }
  return { fetchImpl, calls }
}

// gh stand-in: records secret set/delete, never sees a secret in argv
function fakeExec() {
  const calls = []
  const exec = (cmd, args, o = {}) => { calls.push({ cmd, args, input: o.input, token: o.env?.GH_TOKEN }); return { status: 0, stdout: '', stderr: '' } }
  return { exec, calls }
}

test('App JWT: RS256, verifiable with the App public key, short lived', () => {
  const t = appJwt(123, PEM, Date.parse('2026-01-01T00:00:00Z'))
  verifyJwt(`Bearer ${t}`)
  assert.throws(() => githubApp({ appId: '', pem: '' }), /setup-app/)
})

test('discovery: allowed accounts only, tests_runner* repos only, home repo first and marked self', async () => {
  const gh = fakeGitHub(generateKeys().recipient), logs = []
  const app = githubApp({ appId: 123, pem: PEM, fetchImpl: gh.fetchImpl })
  const rs = await discoverRunners(app, { home: HOME, accounts: ['org1', 'org2'], log: (m) => logs.push(m) })
  assert.deepEqual(rs.map((r) => r.repo), [HOME, 'org1/tests_runner', 'org2/tests_runner_O'])
  assert.equal(rs[0].self, true); assert.equal(rs[0].maxParallel, 19, 'the home repo keeps a slot for the coordinator')
  assert.ok(logs.some((l) => l.includes('stranger') && l.includes('FLEET_ACCOUNTS')), 'a stranger installing the public App never becomes a runner')
})

test('provision: pushes the pinned stub once, then nothing; never pushes to the home repo', async () => {
  const gh = fakeGitHub(generateKeys().recipient)
  const app = githubApp({ appId: 123, pem: PEM, fetchImpl: gh.fetchImpl })
  const runners = await discoverRunners(app, { home: HOME, accounts: ['org1', 'org2'] })
  const r1 = await provision({ runners, home: HOME, sha: SHA, fetchImpl: gh.fetchImpl })
  assert.equal(gh.calls.puts, 2)
  assert.ok(!gh.calls.files[HOME], 'home repo untouched')
  assert.equal(gh.calls.files['org1/tests_runner'].text, stubYaml({ home: HOME, sha: SHA }))
  assert.ok(gh.calls.files['org1/tests_runner'].text.includes(`uses: ${HOME}/.github/workflows/shard-core.yml@${SHA}`))
  assert.ok(Object.values(r1).every((x) => x.state === 'ready'))
  await provision({ runners, home: HOME, sha: SHA, fetchImpl: gh.fetchImpl })
  assert.equal(gh.calls.puts, 2, 'idempotent: an up to date stub is not pushed again')
})

test('coordinator: one App key drives everything; narrowed tokens, secrets via stdin, sealed bundle, infra retry; pull decrypts on the PC', async () => {
  const keys = generateKeys()
  const gh = fakeGitHub(keys.recipient), ex = fakeExec()
  const outDir = tmp(), written = []
  const r = await coordinate({ appId: 123, pem: PEM, home: HOME, sha: SHA, accounts: ['org1', 'org2'], source: 'me/app', ref: 'qa/branch', recipient: keys.recipient,
    testSecrets: { STRIPE_TEST_KEY: 'sk_test_SECRET', github_token: 'ghs_x', FLEET_APP_PRIVATE_KEY: 'pem', OTHER: 'unused' },
    outDir, fetchImpl: gh.fetchImpl, exec: ex.exec, pollMs: 1, retryWaitMs: 1, log: (m) => written.push(m), write: (m) => written.push(m) })

  const srcMint = gh.calls.minted.filter((x) => x.inst === '9' && x.narrow.permissions)
  assert.ok(srcMint.length && srcMint.every((x) => JSON.stringify(x.narrow) === JSON.stringify({ repositories: ['app'], permissions: { contents: 'read' } })), 'source token: one repo, contents read only')
  for (const t of gh.calls.minted) assert.ok(written.includes(`::add-mask::${t.token}\n`), 'every minted token is masked')
  assert.ok(!gh.calls.touched.has('stranger/tests_runner') && !gh.calls.touched.has('org2/blog'))

  const dispatched = gh.calls.dispatch.filter((d) => d.batch.startsWith('b-'))
  assert.deepEqual(dispatched.flatMap((d) => d.units.split(',')).sort(), ['flaky-infra', 'ok-1', 'ok-2', 'red'], 'agent units never go to a runner')
  assert.ok(gh.calls.dispatch.every((d) => d.source === 'me/app' && d.ref === 'qa/branch' && d.recipient === keys.recipient))
  const retry = gh.calls.dispatch.filter((d) => d.batch.startsWith('retry-'))
  assert.equal(retry.length, 1); assert.equal(retry[0].units, 'flaky-infra')
  assert.notEqual(retry[0].repo, dispatched.find((d) => d.units.split(',').includes('flaky-infra')).repo, 'infra retried on another runner')

  const sets = ex.calls.filter((c) => c.args[1] === 'set'), dels = ex.calls.filter((c) => c.args[1] === 'delete')
  assert.deepEqual([...new Set(sets.map((c) => c.args[2]))].sort(), ['FLEET_UNIT_SECRETS', 'SOURCE_REPO_TOKEN'], 'one JSON secret for the test keys + the source token')
  assert.deepEqual(JSON.parse(sets.find((c) => c.args[2] === 'FLEET_UNIT_SECRETS').input), { STRIPE_TEST_KEY: 'sk_test_SECRET' }, 'only the declared test secrets are copied')
  assert.equal(new Set(sets.map((c) => c.args[4])).size, 3, 'secrets set on all 3 runners')
  assert.ok(sets.every((c) => c.token === tokenFor(INSTALLS.find((i) => i.repos.some((x) => x.full_name === c.args[4])).id, { repositories: [c.args[4].split('/')[1]] })), 'each runner with its own narrowed token')
  assert.equal(dels.length, 6, 'per-run secrets deleted from every runner at the end')
  for (const c of ex.calls) for (const s of ['sk_test_SECRET', ...gh.calls.minted.map((x) => x.token)]) assert.ok(!c.args.join(' ').includes(s), 'no secret in argv')

  const files = fs.readdirSync(r.bundle, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(r.bundle, f)).isFile())
  assert.equal(files.filter((f) => f.endsWith('.qaf')).length, 4)
  for (const f of files) {
    const t = fs.readFileSync(path.join(r.bundle, f), 'latin1')
    for (const secret of ['sk_test_SECRET', keys.identity, 'private log', ...gh.calls.minted.map((x) => x.token)]) assert.ok(!t.includes(secret), `${secret.slice(0, 12)} not in ${f}`)
  }
  const pub = JSON.parse(fs.readFileSync(path.join(r.bundle, 'run.json'), 'utf8'))
  assert.equal(pub.results.red.status, 'fail'); assert.equal(pub.results['flaky-infra'].status, 'pass'); assert.equal(pub.results['ok-1'].durationSec, 240)

  // on the PC: gh run download puts the bundle in a folder; pull decrypts it with the local key
  const pcHome = tmp(), proj = project()
  fs.writeFileSync(path.join(pcHome, 'identity.key'), keys.identity)
  const pcExec = (cmd, args) => {
    if (args[0] === 'run' && args[1] === 'view') return { status: 0, stdout: JSON.stringify({ status: 'completed', conclusion: 'failure', url: 'u' }) }
    if (args[0] === 'run' && args[1] === 'download') { const dir = args[args.indexOf('--dir') + 1]; fs.cpSync(outDir, dir, { recursive: true }); return { status: 0, stdout: '' } }
    return { status: 1, stderr: `unexpected gh ${args.join(' ')}` }
  }
  const got = await local.pull({ ghRun: '999', projectDir: proj, home: HOME, exec: pcExec, cfg: { outDir: path.join(pcHome, 'runs'), identityPath: path.join(pcHome, 'identity.key') }, log: () => {} })
  assert.equal(got.results.red.status, 'fail'); assert.equal(got.results.red.junit.failures, 1)
  assert.ok(fs.readFileSync(path.join(got.results['ok-1'].dir, 'qa-fleet-meta', 'unit.log'), 'utf8').includes('private log'), 'decrypted on the PC')
  assert.equal(got.summary.pass, 3); assert.equal(got.summary.fail, 1); assert.ok(fs.existsSync(got.summaryPath))
  assert.equal(JSON.parse(fs.readFileSync(path.join(proj, '.qa-fleet', 'timings.json'), 'utf8'))['ok-1'], 3)
})

test('status mode lists runners without dispatching; dry plan never dispatches', async () => {
  const gh = fakeGitHub(generateKeys().recipient), outDir = tmp()
  const r = await coordinate({ mode: 'status', appId: 123, pem: PEM, home: HOME, sha: SHA, accounts: ['org1'], outDir, fetchImpl: gh.fetchImpl, exec: fakeExec().exec, log: () => {}, write: () => {} })
  assert.deepEqual(r.status.runners.map((x) => [x.repo, x.state]), [[HOME, 'ready'], ['org1/tests_runner', 'ready']])
  assert.ok(fs.existsSync(path.join(outDir, 'status.json')))
  assert.equal(gh.calls.dispatch.length, 0)
  const p = await fleet.makePlan({ cfg: { runners: [{ name: 'a', maxParallel: 2 }, { name: 'b', maxParallel: 2 }] }, projectDir: project() })
  assert.equal(p.units, 4, 'the local explorer unit is never planned on a runner')
})

test('PC side: start the coordinator through gh with the body on stdin; keygen keeps the private key local', () => {
  const ex = []
  const exec = (cmd, args, o = {}) => { ex.push({ args, input: o.input }); return { status: 0, stdout: args[0] === 'api' ? JSON.stringify({ workflow_run_id: 42 }) : '' } }
  const r = local.startRemote({ source: 'me/app', ref: 'qa/branch', only: ['a'], home: HOME, exec })
  assert.equal(r.ghRunId, '42')
  assert.deepEqual(ex[0].args.slice(0, 4), ['api', '-X', 'POST', `repos/${HOME}/actions/workflows/fleet.yml/dispatches`])
  assert.deepEqual(JSON.parse(ex[0].input).inputs, { mode: 'run', source: 'me/app', ref: 'qa/branch', only: 'a', tags: '' })
  assert.throws(() => local.startRemote({ source: 'bad', ref: 'x', home: HOME, exec }), /owner\/name/)
  const h = tmp(), cfg = { outDir: path.join(h, 'runs'), identityPath: path.join(h, 'identity.key') }
  const k = local.keygen({ home: HOME, exec, cfg })
  assert.ok(fs.readFileSync(cfg.identityPath, 'utf8').startsWith('qafsec1:'))
  const v = ex.find((x) => x.args[0] === 'variable')
  assert.equal(v.input, k.recipient); assert.ok(!JSON.stringify(ex).includes('qafsec1:'), 'the private key never leaves the PC')
  const m = local.manifest({ home: HOME, port: 5 })
  assert.deepEqual(Object.keys(m.default_permissions).sort(), ['actions', 'administration', 'contents', 'metadata', 'secrets', 'workflows'])
  assert.equal(m.hook_attributes.active, false)
})

test('MCP server: initialize, tools/list, fleet_plan, errors as tool results', async () => {
  const proj = project()
  const p = spawn(process.execPath, [new URL('../mcp/index.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { env: { ...process.env, QA_FLEET_HOME: tmp(), QA_FLEET_REPO: HOME } })
  const pending = new Map(); let buf = ''
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pending.get(m.id)?.(m) } })
  let id = 0
  const rpc = (method, params) => new Promise((res) => { const k = ++id; pending.set(k, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k, method, params }) + '\n') })
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    assert.equal(init.result.serverInfo.name, 'tests-runner')
    const tools = (await rpc('tools/list', {})).result.tools.map((t) => t.name)
    assert.deepEqual(tools.sort(), ['fleet_explore', 'fleet_plan', 'fleet_pull', 'fleet_result', 'fleet_run', 'fleet_runners', 'fleet_runs'])
    const plan = JSON.parse((await rpc('tools/call', { name: 'fleet_plan', arguments: { project: proj } })).result.content[0].text)
    assert.equal(plan.units, 4)
    const bad = await rpc('tools/call', { name: 'fleet_run', arguments: { source: 'nope', ref: 'x' } })
    assert.equal(bad.result.isError, true)
  } finally { p.kill() }
})
