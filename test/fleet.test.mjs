// End-to-end coordination against a fake GitHub API: status -> plan -> dispatch -> watch -> collect -> infra retry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { generateKeys, sealFile } from '../lib/crypto.mjs'
import { loadConfig } from '../lib/config.mjs'
import * as fleet from '../lib/fleet.mjs'
import { coordinate, pull, sealCard, openSealedCard, BUNDLE } from '../lib/coordinator.mjs'
import { CARD_SCHEMA, cardToConfig } from '../lib/card.mjs'
import { makeZip } from './helpers.mjs'

const TAR = process.platform === 'win32' && fs.existsSync('C:\\Windows\\System32\\tar.exe') ? 'C:\\Windows\\System32\\tar.exe' : 'tar'
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qaf-e2e-'))

function setup() {
  const home = tmp(), project = tmp()
  const keys = generateKeys()
  fs.writeFileSync(path.join(home, 'identity.key'), keys.identity)
  fs.writeFileSync(path.join(home, 'fleet.json'), JSON.stringify({ runners: [1, 2].map((i) => ({ name: `org${i}`, repo: `org${i}/qa-fleet-runner`, token: `tok${i}`, maxParallel: 2 })), sources: { app: { repo: 'me/app' } } }))
  fs.mkdirSync(path.join(project, '.qa-fleet'))
  fs.writeFileSync(path.join(project, '.qa-fleet', 'units.json'), JSON.stringify({ schema: 'qa-fleet/units@1', units: [
    { id: 'ok-1', cmd: 'true', estMinutes: 3 }, { id: 'ok-2', cmd: 'true', estMinutes: 3 }, { id: 'red', cmd: 'false', estMinutes: 2 }, { id: 'flaky-infra', cmd: 'true', estMinutes: 1 },
    { id: 'explore-x', agent: { charter: 'c.md' } },
  ] }))
  return { home, project, keys, cfg: loadConfig(path.join(home, 'fleet.json')) }
}

// sealed artifact zip the way shard.yml builds it
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

function fakeGitHub(recipient, extra = {}) {
  const calls = { dispatch: [] }
  const runs = new Map() // id -> {repo, units, batch}
  const arts = new Map() // artifact id -> zip promise
  let nextRun = 100, nextArt = 1
  const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
  async function fetchImpl(url, init = {}) {
    const u = new URL(url)
    const m = /^\/repos\/([^/]+)\/([^/]+)(.*)$/.exec(u.pathname)
    assert.ok(m, url)
    const repo = `${m[1]}/${m[2]}`, rest = m[3]
    if (extra.route) { const x = await extra.route(repo, rest, u, init, J); if (x) return x }
    assert.equal(init.headers.Authorization, `Bearer tok${repo[3]}`, 'each runner uses its own token')
    if (rest === '') return J({ private: false })
    if (rest === '/actions/secrets') return J({ secrets: [{ name: 'SOURCE_REPO_TOKEN' }] })
    if (rest === '/actions/variables') return J({ variables: [{ name: 'FLEET_RECIPIENT' }, { name: 'ALLOWED_SOURCES' }] })
    if (rest === '/actions/runs' && u.searchParams.get('status')) return J({ workflow_runs: [] })
    if (rest === '/actions/workflows/shard.yml/dispatches') {
      const body = JSON.parse(init.body)
      calls.dispatch.push({ repo, ...body.inputs })
      const id = nextRun++
      runs.set(id, { repo, units: body.inputs.units.split(','), batch: body.inputs.batch, runId: body.inputs.run_id })
      return J({ workflow_run_id: id })
    }
    let r = /^\/actions\/runs\/(\d+)(\/jobs|\/artifacts)?$/.exec(rest)
    if (r) {
      const run = runs.get(Number(r[1]))
      if (!r[2]) return J({ id: Number(r[1]), status: 'completed' })
      const lost = (x) => x === 'flaky-infra' && run.batch.startsWith('b-')
      if (r[2] === '/jobs') return J({ jobs: [{ name: 'validate', status: 'completed' }, ...run.units.map((x) => ({ name: `u:${x}`, status: 'completed', started_at: '2026-01-01T10:00:00Z', completed_at: '2026-01-01T10:04:00Z', conclusion: x === 'red' || lost(x) ? 'failure' : 'success', steps: x === 'red' ? [{ name: 'Result', conclusion: 'failure' }] : lost(x) ? [{ name: 'Infra failure', conclusion: 'failure' }, { name: 'Result', conclusion: 'failure' }] : [] }))] })
      const list = []
      for (const x of run.units) {
        if (x === 'flaky-infra' && run.batch.startsWith('b-')) continue // first attempt: runner lost, no artifact
        const id = nextArt++
        const junit = x === 'red' ? '<testsuite tests="2"><testcase name="a"/><testcase name="b"><failure/></testcase></testsuite>' : '<testsuite tests="1"><testcase name="a"/></testsuite>'
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

test('full cycle: split over runners, decrypt, classify, retry infra once elsewhere, never retry test failures', async () => {
  const { project, keys, cfg } = setup()
  const gh = fakeGitHub(keys.recipient)
  const r = await fleet.runAll({ cfg, projectDir: project, source: 'app', ref: 'qa/branch', fetchImpl: gh.fetchImpl, pollMs: 1, log: () => {} })
  const first = gh.calls.dispatch.filter((d) => d.batch.startsWith('b-'))
  assert.equal(first.length, 2, 'both runners got a batch')
  assert.deepEqual(first.flatMap((d) => d.units.split(',')).sort(), ['flaky-infra', 'ok-1', 'ok-2', 'red'], 'agent units never go to a runner')
  assert.ok(first.every((d) => d.source === 'me/app' && d.ref === 'qa/branch' && d.max_parallel === '2'))
  const retry = gh.calls.dispatch.filter((d) => d.batch.startsWith('retry-'))
  assert.equal(retry.length, 1)
  assert.equal(retry[0].units, 'flaky-infra')
  const firstRepo = first.find((d) => d.units.split(',').includes('flaky-infra')).repo
  assert.notEqual(retry[0].repo, firstRepo, 'retried on another runner')
  assert.equal(r.results['red'].status, 'fail')
  assert.equal(r.results['red'].junit.failures, 1)
  assert.equal(r.results['ok-1'].status, 'pass')
  assert.equal(r.results['flaky-infra'].status, 'pass')
  assert.ok(fs.readFileSync(path.join(r.results['ok-1'].dir, 'qa-fleet-meta', 'unit.log'), 'utf8').includes('private log'), 'decrypted locally')
  assert.equal(r.summary.fail, 1); assert.equal(r.summary.pass, 3)
  assert.ok(fs.existsSync(r.summaryPath))
  const timings = JSON.parse(fs.readFileSync(path.join(project, '.qa-fleet', 'timings.json'), 'utf8'))
  assert.equal(timings['ok-1'], 3)
  for (const d of gh.calls.dispatch) assert.ok(!JSON.stringify(d).includes('true'), 'no command text is ever dispatched')
})

test('dry run plans without dispatching', async () => {
  const { project, keys, cfg } = setup()
  const gh = fakeGitHub(keys.recipient)
  const r = await fleet.runAll({ cfg, projectDir: project, source: 'app', ref: 'main', dry: true, fetchImpl: gh.fetchImpl, log: () => {} })
  assert.equal(r.dry, true)
  assert.equal(gh.calls.dispatch.length, 0)
  assert.equal(r.plan.units, 4, 'the local explorer unit is never planned on a runner')
})

test('MCP server: initialize, tools/list, fleet_plan, errors as tool results', async () => {
  const { home, project } = setup()
  const p = spawn(process.execPath, [new URL('../mcp/index.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { env: { ...process.env, QA_FLEET_CONFIG: path.join(home, 'fleet.json'), QA_FLEET_GITHUB_API: 'http://127.0.0.1:9' } })
  const pending = new Map(); let buf = ''
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pending.get(m.id)?.(m) } })
  let id = 0
  const rpc = (method, params) => new Promise((res) => { const k = ++id; pending.set(k, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k, method, params }) + '\n') })
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    assert.equal(init.result.serverInfo.name, 'qa-fleet')
    const tools = (await rpc('tools/list', {})).result.tools.map((t) => t.name)
    for (const t of ['fleet_status', 'fleet_plan', 'fleet_run', 'fleet_watch', 'fleet_collect', 'fleet_cancel', 'fleet_runs', 'fleet_coordinate', 'fleet_pull', 'fleet_explore', 'fleet_tokens']) assert.ok(tools.includes(t), t)
    const planRes = await rpc('tools/call', { name: 'fleet_plan', arguments: { project } })
    const plan = JSON.parse(planRes.result.content[0].text)
    assert.equal(plan.units, 4)
    const st = await rpc('tools/call', { name: 'fleet_status', arguments: {} })
    assert.ok(!st.result.content[0].text.includes('tok1'), 'tokens are never returned')
    const bad = await rpc('tools/call', { name: 'fleet_watch', arguments: { runId: 'nope' } })
    assert.equal(bad.result.isError, true)
  } finally { p.kill() }
})

test('coordinator: sealed card, masks, sealed-only bundle, public infra retry; pull decrypts on the PC', async () => {
  const { project, keys } = setup()
  const units = fs.readFileSync(path.join(project, '.qa-fleet', 'units.json'))
  const card = { card: CARD_SCHEMA, runners: [1, 2].map((i) => ({ owner: `org${i}`, repo: 'qa-fleet-runner', token: `tok${i}`, maxParallel: 2 })), coordinator: { repo: 'org1/qa-fleet-runner' },
    source: { name: 'app', repo: 'me/app', readToken: 'tokSRC', testBranch: 'qa/branch' }, secrets: { STRIPE_TEST_KEY: 'sk_test_SECRET' }, results: { identity: keys.identity } }
  const { sealed, key } = sealCard(card)
  const inner = openSealedCard(sealed, key)
  assert.equal(inner.secrets, undefined, 'test secrets are not in the sealed card')
  assert.equal(inner.results, undefined, 'the result key is not in the sealed card')
  assert.throws(() => openSealedCard(sealed, generateKeys().identity), /wrong key/)

  const route = async (repo, rest, u, init, J) => {
    if (repo !== 'me/app') return null
    assert.equal(init.headers.Authorization, 'Bearer tokSRC', 'the source is read with its read-only token')
    if (rest === '/contents/.qa-fleet/units.json') { assert.equal(u.searchParams.get('ref'), 'qa/branch'); return J({ content: units.toString('base64'), encoding: 'base64' }) }
    return J({ message: 'Not Found' }, 404)
  }
  const gh = fakeGitHub(keys.recipient, { route })
  const outDir = tmp(), written = []
  const r = await coordinate({ sealed, key, source: 'app', ref: 'qa/branch', outDir, fetchImpl: gh.fetchImpl, pollMs: 1, log: (m) => written.push(m), write: (m) => written.push(m) })
  for (const t of ['tok1', 'tok2', 'tokSRC']) assert.ok(written.includes(`::add-mask::${t}\n`), `mask ${t}`)
  assert.equal(gh.calls.dispatch.filter((d) => d.batch.startsWith('retry-')).length, 1, 'infra retried once from the public signal')
  const files = fs.readdirSync(r.bundle, { recursive: true }).map(String)
  assert.deepEqual(files.filter((f) => f.endsWith('.qaf')).length, 4)
  assert.ok(!files.some((f) => f.includes('units') && f.endsWith('.log')), 'nothing decrypted in the bundle')
  for (const f of files.filter((x) => fs.statSync(path.join(r.bundle, x)).isFile())) {
    const t = fs.readFileSync(path.join(r.bundle, f), 'latin1')
    for (const secret of ['tok1', 'tok2', 'tokSRC', 'sk_test_SECRET', keys.identity, 'private log']) assert.ok(!t.includes(secret), `${secret} not in ${f}`)
  }
  const pub = JSON.parse(fs.readFileSync(path.join(r.bundle, 'run.json'), 'utf8'))
  assert.equal(pub.results.red.status, 'fail'); assert.equal(pub.results['flaky-infra'].status, 'pass'); assert.equal(pub.results['ok-1'].durationSec, 240)

  // pull on the PC: download fleet-bundle of the coordinator run, decrypt with the local key
  const zip = makeZip(files.filter((x) => fs.statSync(path.join(r.bundle, x)).isFile()).map((f) => [f.replaceAll('\\', '/'), fs.readFileSync(path.join(r.bundle, f))]))
  const pc = { ...cardToConfig(card, 'card'), outDir: tmp() }
  const pullFetch = async (url, init) => {
    const p = new URL(url).pathname
    assert.equal(init.headers.Authorization, 'Bearer tok1', 'pull uses the coordinator runner token')
    if (p.endsWith('/actions/runs/999')) return new Response(JSON.stringify({ status: 'completed' }), { status: 200 })
    if (p.endsWith('/actions/runs/999/artifacts')) return new Response(JSON.stringify({ artifacts: [{ id: 7, name: BUNDLE, expired: false }] }), { status: 200 })
    if (p.endsWith('/actions/artifacts/7/zip')) return new Response(zip, { status: 200 })
    return new Response('{}', { status: 404 })
  }
  const got = await pull({ cfg: pc, ghRun: '999', projectDir: project, fetchImpl: pullFetch, log: () => {} })
  assert.equal(got.results.red.status, 'fail'); assert.equal(got.results.red.junit.failures, 1)
  assert.ok(fs.readFileSync(path.join(got.results['ok-1'].dir, 'qa-fleet-meta', 'unit.log'), 'utf8').includes('private log'), 'decrypted on the PC')
  assert.equal(got.summary.pass, 3); assert.ok(fs.existsSync(got.summaryPath))
})
