// Fleet card: template, validation, config mapping, bootstrap and test-branch detection against a fake GitHub.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readCard, updateCard, validateCard } from '../lib/card.mjs'
import { loadConfig, identityOf } from '../lib/config.mjs'
import { bootstrap, findBranch, recipientOf } from '../lib/bootstrap.mjs'
import { setupCoordinator, openSealedCard } from '../lib/coordinator.mjs'

const TEMPLATE = new URL('../card/QA-FLEET-CARD.md', import.meta.url)
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qaf-card-'))
const TOKENS = ['github_pat_AAA111', 'github_pat_BBB222', 'github_pat_SRC999', 'sk_test_51abc', 'sk-ant-oat01-xyz']

function filledCard({ runners = 2 } = {}) {
  const p = path.join(tmp(), 'QA-FLEET-CARD.md')
  fs.copyFileSync(TEMPLATE, p)
  updateCard(p, (c) => {
    c.runners = c.runners.slice(0, runners).map((r, i) => ({ owner: `alice${i + 1}`, repo: 'qa-fleet-runner', token: TOKENS[i], maxParallel: 20 }))
    c.source = { ...c.source, repo: 'me/app', readToken: TOKENS[2], fallbackBranches: ['qa/planned-coverage'], markers: ['qa-pack/pack.json'] }
    c.coordinator.repo = 'alice1/qa-fleet-runner'
    c.secrets = { STRIPE_TEST_KEY: TOKENS[3], PAYMENT_TEST_KEY: TOKENS[4] }
  })
  return p
}

const J = (o, status = 200) => new Response(o == null ? '' : JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

test('template: parses, an empty card lists what to fill, a filled one maps to a config', () => {
  const empty = readCard(TEMPLATE)
  assert.equal(empty.runners.length, 5)
  const v = validateCard(empty)
  for (const s of ['runners[0].owner', 'runners[4].token', 'readToken']) assert.ok(v.errors.some((e) => e.includes(s)), s)
  const p = filledCard()
  assert.deepEqual(validateCard(readCard(p)).errors, [])
  const text = fs.readFileSync(p, 'utf8')
  assert.ok(text.includes('## Part D: build the test branch'), 'instructions around the json block are kept')
  const cfg = loadConfig(p)
  assert.deepEqual(cfg.runners.map((r) => r.repo), ['alice1/qa-fleet-runner', 'alice2/qa-fleet-runner'])
  assert.equal(cfg.sources.app.repo, 'me/app')
  assert.equal(cfg.coordinator.repo, 'alice1/qa-fleet-runner')
  assert.equal(cfg.coordinator.token, TOKENS[0], 'the coordinator is dispatched with its runner token')
  updateCard(p, (c) => { c.secrets.CLAUDE_CODE_OAUTH_TOKEN = 'x' })
  assert.ok(validateCard(readCard(p)).errors.some((e) => e.includes('Claude credentials')), 'Claude tokens are refused')
  updateCard(p, (c) => { delete c.secrets.CLAUDE_CODE_OAUTH_TOKEN; c.coordinator.repo = 'bob/elsewhere' })
  assert.ok(validateCard(readCard(p)).errors.some((e) => e.includes('must also be one of the runners')))
  updateCard(p, (c) => { c.coordinator.repo = 'alice1/qa-fleet-runner' })
  assert.throws(() => identityOf(cfg), /bootstrap/)
  updateCard(p, (c) => { c.secrets.STRIPE_TEST_KEY = 'sk_live_x' })
  assert.ok(validateCard(readCard(p)).errors.some((e) => e.includes('TEST key')))
})

test('bootstrap: key into the card, code push, variables, secrets; tokens never in argv or logs; one bad runner does not stop the others', async () => {
  const p = filledCard()
  const calls = [], execs = [], logs = []
  const fetchImpl = async (url, init) => {
    const u = new URL(url), tok = init.headers.Authorization.slice(7)
    calls.push(`${init.method} ${u.pathname} ${tok === TOKENS[0] ? 'A' : tok === TOKENS[1] ? 'B' : '?'}`)
    if (u.pathname.startsWith('/repos/alice2/')) return J({ message: 'Not Found' }, 404)
    assert.equal(tok, TOKENS[0], 'runner 1 uses its own token')
    if (u.pathname === '/repos/alice1/qa-fleet-runner') return J({ private: false })
    if (u.pathname.endsWith('/branches/main')) return J({ message: 'Branch not found' }, 404)
    if (init.method === 'PATCH') return J({ message: 'Not Found' }, 404)
    return J(null, init.method === 'POST' ? 201 : 204)
  }
  const exec = (cmd, args, opts = {}) => {
    execs.push({ cmd, args, env: opts.env, input: opts.input })
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { status: 128, stdout: '', stderr: 'not a git repo' }
    if (args[0] === 'rev-parse') return { status: 0, stdout: 'c0ffee0000000000000000000000000000000000\n' }
    if (args[0] === 'status') return { status: 0, stdout: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  const r = await bootstrap({ cardPath: p, fetchImpl, exec, log: (m) => logs.push(m) })

  const card = readCard(p)
  assert.match(card.results.identity, /^qafsec1:/)
  assert.equal(card.results.recipient, recipientOf(card.results.identity))
  const push = execs.find((e) => e.args[0] === 'push')
  assert.ok(push.args.includes('c0ffee0000000000000000000000000000000000:refs/heads/main'))
  assert.match(push.env.GIT_CONFIG_VALUE_0, /^AUTHORIZATION: basic /)
  const secrets = execs.filter((e) => e.cmd === 'gh')
  assert.deepEqual(secrets.map((e) => e.args[2]), ['SOURCE_REPO_TOKEN', 'STRIPE_TEST_KEY', 'PAYMENT_TEST_KEY'])
  assert.ok(secrets.every((e) => e.env.GH_TOKEN === TOKENS[0] && e.args.includes('alice1/qa-fleet-runner')))
  assert.equal(secrets[0].input, TOKENS[2])
  assert.ok(calls.includes('POST /repos/alice1/qa-fleet-runner/actions/variables A'))
  assert.ok(calls.includes('PUT /repos/alice1/qa-fleet-runner/actions/permissions/workflow A'))
  for (const t of [...TOKENS, card.results.identity]) {
    assert.ok(!execs.some((e) => e.args.join(' ').includes(t)), 'no secret in argv')
    assert.ok(!logs.join('\n').includes(t), 'no secret in the log')
  }
  assert.equal(r.ok, false)
  assert.deepEqual(r.report[0].problems, [])
  assert.match(r.report[1].problems[0], /EMPTY PUBLIC repo/)

  // rerun: key is kept, code already there
  const id = card.results.identity
  await bootstrap({ cardPath: p, only: ['alice1'], dry: true, fetchImpl: async (url, init) => (new URL(url).pathname.endsWith('/branches/main') ? J({ commit: { sha: 'c0ffee0000000000000000000000000000000000' } }) : fetchImpl(url, init)), exec, log: (m) => logs.push(m) })
  assert.equal(readCard(p).results.identity, id)
  assert.ok(logs.some((l) => l.includes('code already at c0ffee00')))
})

test('bootstrap refuses a card that sits inside a git repository', async () => {
  const p = filledCard()
  const exec = (cmd, args) => (args[1] === '--show-toplevel' ? { status: 0, stdout: '/work/app\n' } : { status: 0, stdout: '' })
  await assert.rejects(bootstrap({ cardPath: p, exec, fetchImpl: async () => J({}), log: () => {} }), /inside the git repository/)
})

test('findBranch: ready branch, branch without .qa-fleet, missing branch', async () => {
  const p = filledCard()
  const card = readCard(p)
  const have = { 'qa/planned-coverage': ['qa-pack/pack.json', 'qa/browser-tests/conventions.md'] }
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${TOKENS[2]}`, 'the source is read with readToken')
    const u = new URL(url)
    if (u.pathname === '/repos/me/app') return J({ private: true })
    const b = /\/branches\/(.+)$/.exec(u.pathname)
    if (b) return decodeURIComponent(b[1]) in have ? J({ commit: { sha: 'abc' } }) : J({}, 404)
    const f = /\/contents\/(.+)$/.exec(u.pathname)
    return (have[u.searchParams.get('ref')] ?? []).includes(f[1]) ? J({}) : J({}, 404)
  }
  let [r] = await findBranch({ card, fetchImpl })
  assert.equal(r.use, null)
  assert.equal(r.checked[0].state, 'missing')
  assert.match(r.checked[1].state, /no fleet units/)
  assert.match(r.next, /D2/)
  have['qa/fleet'] = ['.qa-fleet/units.json', 'qa-pack/pack.json'];
  [r] = await findBranch({ card, fetchImpl })
  assert.equal(r.use, 'qa/fleet')
  delete have['qa/fleet']; delete have['qa/planned-coverage'];
  [r] = await findBranch({ card, fetchImpl })
  assert.match(r.next, /from scratch/)
})

test('bootstrap --coordinator: environment with reviewer + main only, sealed card through gh stdin, never in argv', async () => {
  const card = readCard(filledCard())
  const calls = [], execs = []
  const fetchImpl = async (url, init) => {
    const u = new URL(url)
    assert.equal(init.headers.Authorization, `Bearer ${TOKENS[0]}`)
    calls.push(`${init.method} ${u.pathname} ${init.body ?? ''}`)
    if (u.pathname === '/users/alice1') return J({ id: 42 })
    if (init.method === 'PATCH') return J({ message: 'Not Found' }, 404)
    return J({}, init.method === 'POST' ? 201 : 200)
  }
  const exec = (cmd, args, opts) => { execs.push({ cmd, args, ...opts }); return { status: 0, stdout: '', stderr: '' } }
  const r = await setupCoordinator({ card, fetchImpl, exec, log: () => {} })
  assert.deepEqual(r.problems, [])
  assert.ok(calls.some((c) => c.startsWith('PUT /repos/alice1/qa-fleet-runner/environments/fleet') && c.includes('"id":42') && c.includes('"custom_branch_policies":true')))
  assert.ok(calls.some((c) => c.includes('deployment-branch-policies') && c.includes('"main"')))
  assert.ok(calls.some((c) => c.startsWith('POST /repos/alice1/qa-fleet-runner/actions/variables') && c.includes('FLEET_COORDINATOR')))
  const [sealedSet, keySet] = execs
  assert.deepEqual(sealedSet.args.slice(0, 5), ['secret', 'set', 'FLEET_CARD_SEALED', '--env', 'fleet'])
  const inner = openSealedCard(sealedSet.input, keySet.input)
  assert.equal(inner.runners[0].token, TOKENS[0])
  assert.equal(inner.secrets, undefined)
  for (const e of execs) for (const t of [...TOKENS, sealedSet.input, keySet.input]) assert.ok(!e.args.join(' ').includes(t), 'no secret in argv')
})
