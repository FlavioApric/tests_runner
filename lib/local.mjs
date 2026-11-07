// Everything a session does on the owner's PC, with the gh CLI login only (no token is ever read, stored or printed).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
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
