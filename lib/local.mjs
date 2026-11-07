// Everything a session does on the owner's PC, with the gh CLI login only (no token is ever read, stored or printed).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import readline from 'node:readline'
import crypto from 'node:crypto'
import { gh, defaultExec } from './gh.mjs'
import { localConfig, homeRepo, identityOf, fleetHome, checkRepo } from './config.mjs'
import { generateKeys } from './crypto.mjs'
import * as fleet from './fleet.mjs'

export const WORKFLOW = 'fleet.yml'
export const ENVIRONMENT = 'fleet'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const json = (s) => JSON.parse(s || 'null')

// start the coordinator. mode: run | status | provision
export function startRemote({ mode = 'run', source = '', ref = '', only = [], tags = [], home = homeRepo(), exec = defaultExec } = {}) {
  if (mode === 'run') { checkRepo('--source', source); if (!ref) throw new Error('--ref (a PUSHED branch, tag or sha of the source) is required') }
  const body = { ref: 'main', inputs: { mode, source, ref, only: only.join(','), tags: tags.join(',') }, return_run_details: true }
  const out = json(gh(['api', '-X', 'POST', `repos/${home}/actions/workflows/${WORKFLOW}/dispatches`, '--input', '-'], { input: JSON.stringify(body), exec }))
  const id = out?.workflow_run_id
  if (!id) throw new Error('GitHub did not return the run id (update gh, or look at the Actions tab)')
  return { ghRunId: String(id), url: `https://github.com/${home}/actions/runs/${id}` }
}

export function runState(id, { home = homeRepo(), exec = defaultExec } = {}) {
  return json(gh(['run', 'view', String(id), '--repo', home, '--json', 'status,conclusion,url,displayTitle,createdAt'], { exec }))
}

export async function waitRemote(id, { home = homeRepo(), exec = defaultExec, pollMs = 20000, log = () => {} } = {}) {
  for (;;) {
    const s = runState(id, { home, exec })
    if (s.status === 'completed') return s
    log(`coordinator ${id}: ${s.status}`)
    await sleep(pollMs)
  }
}

function download(id, { home, exec }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaf-bundle-'))
  gh(['run', 'download', String(id), '--repo', home, '--name', 'fleet-bundle', '--dir', dir], { exec })
  return dir
}

// runners as the coordinator sees them (mode=status)
export async function runners({ home = homeRepo(), exec = defaultExec, pollMs, log } = {}) {
  const { ghRunId, url } = startRemote({ mode: 'status', home, exec })
  const s = await waitRemote(ghRunId, { home, exec, pollMs, log })
  if (s.conclusion !== 'success') throw new Error(`status run failed: ${url}`)
  const dir = download(ghRunId, { home, exec })
  try { return json(fs.readFileSync(path.join(dir, 'status.json'), 'utf8')) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

// download the bundle of a completed coordinator run and decrypt every unit with the local private key
export async function pull({ ghRun, projectDir, home = homeRepo(), exec = defaultExec, cfg = localConfig(), log = console.error }) {
  const s = runState(ghRun, { home, exec })
  if (s.status !== 'completed') throw new Error(`coordinator run ${ghRun} is ${s.status}: pull it when it has completed`)
  const identity = identityOf(cfg)
  const tmp = download(ghRun, { home, exec })
  try {
    const runFile = fs.readdirSync(tmp, { recursive: true }).map((f) => path.join(tmp, String(f))).find((f) => path.basename(f) === 'run.json')
    if (!runFile) throw new Error(`run ${ghRun} has no results bundle (it failed before dispatching: ${s.url})`)
    const run = JSON.parse(fs.readFileSync(runFile, 'utf8'))
    const root = path.dirname(runFile)
    const dest = fleet.runDir(cfg, run.runId)
    for (const [u, r] of Object.entries(run.results)) {
      if (!r.sealed) continue
      const job = run.batches.find((b) => b.batch === r.batch)?.jobs?.[u]
      const dir = path.join(dest, 'units', u)
      try {
        const { meta, junit } = await fleet.openSealedInto(path.join(root, r.sealed), dir, identity)
        run.results[u] = fleet.decryptedResult(meta, junit, dir, job, { batch: r.batch, runner: r.runner, publicStatus: r.status })
      } catch (e) { log(`unit ${u}: cannot open results: ${e.message}`) }
    }
    run.ghCoordinatorRun = String(ghRun)
    run.projectDir = projectDir ? path.resolve(projectDir) : null
    fleet.saveRun(cfg, run)
    fleet.writeTimings(run)
    const sum = fleet.summary(run)
    fs.writeFileSync(path.join(dest, 'SUMMARY.md'), sum.markdown)
    return { ...run, summary: sum, summaryPath: path.join(dest, 'SUMMARY.md') }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

// result key pair: private key stays here, the PUBLIC key becomes vars.FLEET_RECIPIENT of the home repo
export function keygen({ force = false, home = homeRepo(), exec = defaultExec, cfg = localConfig() } = {}) {
  if (fs.existsSync(cfg.identityPath) && !force) {
    return { identity: cfg.identityPath, note: 'exists (use --force to replace it: older results could no longer be opened)' }
  }
  const k = generateKeys()
  fs.mkdirSync(path.dirname(cfg.identityPath), { recursive: true })
  fs.writeFileSync(cfg.identityPath, k.identity + '\n', { mode: 0o600 })
  gh(['variable', 'set', 'FLEET_RECIPIENT', '--repo', home], { input: k.recipient, exec })
  return { identity: cfg.identityPath, recipient: k.recipient, note: `public key set as FLEET_RECIPIENT on ${home}` }
}

// test keys the units declare (secrets: [...]): ONE environment secret FLEET_TEST_SECRETS = {"NAME":"value"}, uploaded from a local file
export function testSecrets({ file, home = homeRepo(), exec = defaultExec } = {}) {
  const p = file ?? path.join(fleetHome(), 'test-secrets.json')
  if (!fs.existsSync(p)) throw new Error(`no file ${p}: write {"STRIPE_TEST_KEY":"sk_test_..."} there (test keys only), then run this again`)
  const text = fs.readFileSync(p, 'utf8')
  const o = JSON.parse(text)
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('the file must be a JSON object {"NAME":"value"}')
  for (const [k, v] of Object.entries(o)) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(k) || /^(GITHUB_|FLEET_|SOURCE_REPO_TOKEN)/.test(k)) throw new Error(`bad secret name "${k}"`)
    if (typeof v !== 'string' || /[\r\n]/.test(v)) throw new Error(`${k}: the value must be a single-line string`)
    if (/CLAUDE|ANTHROPIC/i.test(k)) throw new Error(`${k}: Claude credentials never go to a runner`)
  }
  gh(['secret', 'set', 'FLEET_TEST_SECRETS', '--env', ENVIRONMENT, '--repo', home], { input: JSON.stringify(o), exec })
  return { names: Object.keys(o), note: `stored as FLEET_TEST_SECRETS in the "${ENVIRONMENT}" environment of ${home} (values never printed)` }
}

// A token runner: one repo, one fine-grained token (Actions, Contents, Workflows, Secrets, Administration: read/write on that
// repo). Secrets are write-only on GitHub, so the full list is kept in ~/.qa-fleet/runner-tokens.json (mode 600, outside any repo)
// and re-uploaded whole each time. Sessions never need that file: only adding or rotating a token does.
export const runnerTokensPath = () => path.join(fleetHome(), 'runner-tokens.json')
export async function addRunner({ repo, token, home = homeRepo(), exec = defaultExec, fetchImpl = globalThis.fetch, ask = askHidden } = {}) {
  if (!/^[A-Za-z0-9_.-]+\/tests_runner[A-Za-z0-9_.-]*$/i.test(repo ?? '')) throw new Error('add-runner owner/tests_runner  (the repo name must start with tests_runner)')
  token ??= await ask(`fine-grained token for ${repo} (only that repo): `)
  token = token.trim()
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'tests_runner' }
  const r = await fetchImpl(`https://api.github.com/repos/${repo}`, { headers: h })
  if (r.status !== 200) throw new Error(`that token cannot see ${repo} (${r.status}): check the repo name and the token's repository access`)
  const info = await r.json()
  if (info.private) throw new Error(`${repo} is private: Actions minutes would be billed, make it public first`)
  const list = fs.existsSync(runnerTokensPath()) ? JSON.parse(fs.readFileSync(runnerTokensPath(), 'utf8')) : []
  const next = [...list.filter((e) => e.repo.toLowerCase() !== repo.toLowerCase()), { repo, token }]
  fs.mkdirSync(fleetHome(), { recursive: true })
  fs.writeFileSync(runnerTokensPath(), JSON.stringify(next, null, 1), { mode: 0o600 })
  return uploadRunnerTokens({ home, exec, repos: next.map((e) => e.repo) })
}
// One call per account: token in -> runner repo created (empty, public) if missing -> registered. Idempotent.
// A classic token (scope repo) or a fine-grained token that is allowed to create repositories can create the repo; with a
// fine-grained token limited to existing repos, create the empty public `tests_runner` repo first (the error says so).
export async function addAccount({ token, home = homeRepo(), exec = defaultExec, fetchImpl = globalThis.fetch } = {}) {
  token = (token ?? '').trim()
  if (token.length < 20) throw new Error('no token')
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'tests_runner', 'Content-Type': 'application/json' }
  const u = await fetchImpl('https://api.github.com/user', { headers: h })
  if (u.status !== 200) throw new Error(`the token is not valid (${u.status})`)
  const login = (await u.json()).login
  const repo = `${login}/tests_runner`
  const have = await fetchImpl(`https://api.github.com/repos/${repo}`, { headers: h })
  let created = false
  if (have.status === 404) {
    const c = await fetchImpl('https://api.github.com/user/repos', { method: 'POST', headers: h, body: JSON.stringify({ name: 'tests_runner', private: false, description: 'tests_runner runner repo (managed by the fleet coordinator)', auto_init: false }) })
    if (c.status !== 201) throw new Error(`${login}: cannot create ${repo} with this token (${c.status}): create an empty PUBLIC repo named tests_runner in that account, then run this again`)
    created = true
  } else if (have.status !== 200) throw new Error(`${login}: cannot read ${repo} (${have.status})`)
  const r = await addRunner({ repo, token, home, exec, fetchImpl })
  return { login, repo, created, runners: r.runners }
}

// tokens from a file (one per line, # comments allowed) or one hidden prompt; the file is deleted after a successful run if --delete
export async function addAccounts({ file, token, home, exec, fetchImpl, ask = askHidden, remove = false } = {}) {
  const tokens = token ? [token] : file ? fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [await ask('token of the account (classic with scope repo, or fine-grained): ')]
  const out = []
  for (const t of tokens) {
    try { out.push({ ok: true, ...(await addAccount({ token: t, home, exec, fetchImpl })) }) }
    catch (e) { out.push({ ok: false, error: e.message.split(t.trim()).join('***') }) }
  }
  if (file && remove && out.every((x) => x.ok)) fs.rmSync(file, { force: true })
  return out
}

export function uploadRunnerTokens({ home = homeRepo(), exec = defaultExec, repos } = {}) {
  const list = JSON.parse(fs.readFileSync(runnerTokensPath(), 'utf8'))
  gh(['secret', 'set', 'FLEET_RUNNER_TOKENS', '--env', ENVIRONMENT, '--repo', home], { input: JSON.stringify(list), exec })
  return { runners: repos ?? list.map((e) => e.repo), note: `stored as FLEET_RUNNER_TOKENS in the "${ENVIRONMENT}" environment of ${home} (tokens never printed)` }
}
function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s) }
    rl.question(q, (a) => { rl.output.write('\n'); rl.close(); resolve(a) })
  })
}

// other accounts whose App installations may act as runners
export function allow({ logins, home = homeRepo(), exec = defaultExec }) {
  let cur = ''
  try { cur = json(gh(['variable', 'get', 'FLEET_ACCOUNTS', '--repo', home, '--json', 'value'], { exec }))?.value ?? '' } catch { /* not set yet */ }
  const set = [...new Set([...cur.split(','), ...logins].map((s) => s.trim()).filter(Boolean))]
  for (const l of set) if (!/^[A-Za-z0-9-]{1,39}$/.test(l)) throw new Error(`bad GitHub login "${l}"`)
  gh(['variable', 'set', 'FLEET_ACCOUNTS', '--repo', home], { input: set.join(','), exec })
  return { accounts: set }
}

export const appInfoPath = () => path.join(fleetHome(), 'app.json')
export const installUrl = (slug) => `https://github.com/apps/${slug}/installations/new`

// The App manifest: the only permissions the fleet uses. No webhook, no user data.
export function manifest({ home, port }) {
  const owner = home.split('/')[0]
  return {
    name: `tests-runner-${owner}`.slice(0, 34),
    url: `https://github.com/${home}`,
    description: `Test fleet of ${home}: provisions runner repos, sets per-run secrets, dispatches test shards.`,
    hook_attributes: { url: `https://github.com/${home}`, active: false },
    redirect_url: `http://127.0.0.1:${port}/callback`,
    public: true,
    default_permissions: { actions: 'write', contents: 'write', workflows: 'write', secrets: 'write', administration: 'write', metadata: 'read' },
    default_events: [],
  }
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try { defaultExec(cmd, args) } catch { /* the url is printed too */ }
}

// One-time: create the App from the manifest (one click in the browser), store its id and key in the home repo,
// create the "fleet" environment (main only). Returns the install link for every account.
export async function setupApp({ home = homeRepo(), exec = defaultExec, log = console.error, fetchImpl = globalThis.fetch, open = openBrowser, timeoutMs = 10 * 60000 } = {}) {
  const state = crypto.randomBytes(16).toString('hex')
  let port
  const code = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      if (u.pathname === '/') {
        const m = JSON.stringify(manifest({ home, port })).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
        res.writeHead(200, { 'content-type': 'text/html' })
        return res.end(`<!doctype html><meta charset="utf-8"><title>Create the fleet App</title><body onload="document.forms[0].submit()"><form method="post" action="https://github.com/settings/apps/new?state=${state}"><input type="hidden" name="manifest" value="${m}"><p>Opening GitHub…</p><button>Continue</button></form>`)
      }
      if (u.pathname === '/callback') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<!doctype html><meta charset="utf-8"><p>Done: the App is created. You can close this tab and go back to the terminal.</p>')
        srv.close()
        if (u.searchParams.get('state') !== state) return reject(new Error('state mismatch: start again'))
        return resolve(u.searchParams.get('code'))
      }
      res.writeHead(404); res.end()
    })
    srv.listen(0, '127.0.0.1', () => {
      port = srv.address().port
      const url = `http://127.0.0.1:${port}/`
      log(`Opening ${url} → GitHub. Click "Create GitHub App" (logged in as ${home.split('/')[0]}).`)
      open(url)
    })
    setTimeout(() => { srv.close(); reject(new Error('timed out waiting for GitHub (10 minutes)')) }, timeoutMs).unref()
  })
  const r = await fetchImpl(`https://api.github.com/app-manifests/${code}/conversions`, { method: 'POST', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'tests_runner' } })
  if (r.status !== 201) throw new Error(`GitHub did not convert the manifest (${r.status})`)
  const a = await r.json()
  // environment "fleet": only main may use it
  gh(['api', '-X', 'PUT', `repos/${home}/environments/${ENVIRONMENT}`, '--input', '-'], { input: JSON.stringify({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }), exec })
  try { gh(['api', '-X', 'POST', `repos/${home}/environments/${ENVIRONMENT}/deployment-branch-policies`, '--input', '-'], { input: JSON.stringify({ name: 'main', type: 'branch' }), exec }) } catch (e) { if (!/already|exists|422/i.test(e.message)) throw e }
  gh(['secret', 'set', 'FLEET_APP_PRIVATE_KEY', '--env', ENVIRONMENT, '--repo', home], { input: a.pem, exec })
  gh(['variable', 'set', 'FLEET_APP_ID', '--repo', home], { input: String(a.id), exec })
  const info = { id: a.id, slug: a.slug, url: a.html_url, home, install: installUrl(a.slug) }
  fs.mkdirSync(fleetHome(), { recursive: true })
  fs.writeFileSync(appInfoPath(), JSON.stringify(info, null, 1))
  return info
}

export function appInfo() { return fs.existsSync(appInfoPath()) ? JSON.parse(fs.readFileSync(appInfoPath(), 'utf8')) : null }
