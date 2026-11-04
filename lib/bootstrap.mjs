// Everything a fleet card needs to become a working fleet, with the card's tokens only:
//   bootstrap   per runner repo: check it is public, push this qa-fleet code to main, enable Actions (read-only
//               GITHUB_TOKEN), set the variables FLEET_RECIPIENT + ALLOWED_SOURCES and the secrets
//               SOURCE_REPO_TOKEN + the card's secrets{}. Creates the result key pair into the card if missing.
//   findBranch  which source branch carries the full tests (.qa-fleet/units.json + the card's markers)
//   checkout    read-only local copy of that branch (the cloud run reads units.json from a local copy)
// Tokens never reach argv or logs: git gets them through GIT_CONFIG_* env, gh through GH_TOKEN.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readCard, updateCard, validateCard, sourcesOf, DEFAULT_REPO } from './card.mjs'
import { generateKeys } from './crypto.mjs'

const API = () => process.env.QA_FLEET_GITHUB_API || 'https://api.github.com'
export const TOOL_DIR = path.resolve(import.meta.dirname, '..')
export const recipientOf = (identity) => `qafpub1:${String(identity).trim().split(':')[2]}`
const defaultExec = (cmd, args, { env, input, cwd } = {}) => spawnSync(cmd, args, { cwd, input, encoding: 'utf8', env: { ...process.env, ...env } })

export function api(token, { fetchImpl = globalThis.fetch } = {}) {
  return async (method, url, body, ok = [200, 201, 202, 204]) => {
    const r = await fetchImpl(`${API()}${url}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'qa-fleet', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const text = await r.text().catch(() => '')
    if (!ok.includes(r.status)) throw Object.assign(new Error(`${method} ${url} -> ${r.status} ${text.slice(0, 160)}`), { status: r.status })
    return text ? JSON.parse(text) : null
  }
}

// git auth by env only (never in argv, never in .git/config)
export const gitAuthEnv = (token) => ({ GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`, GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '' })

const redact = (s, secrets) => secrets.filter(Boolean).reduce((a, v) => a.split(v).join('***'), String(s ?? ''))

export async function bootstrap({ cardPath, only, dry = false, forceTemplate = false, toolDir = TOOL_DIR, fetchImpl, exec = defaultExec, log = console.log } = {}) {
  const where = path.resolve(cardPath)
  const top = exec('git', ['rev-parse', '--show-toplevel'], { cwd: path.dirname(where) })
  if (top.status === 0 && top.stdout.trim()) throw new Error(`the card is inside the git repository ${top.stdout.trim()}: move it out (e.g. ~/.qa-fleet/) before it gets committed`)
  if (/google ?drive|il mio drive|my drive|onedrive|dropbox|icloud/i.test(where)) log(`warning: the card is in a synced folder (${path.dirname(where)}): its tokens get copied to the cloud, move it to ~/.qa-fleet/`)
  let card = readCard(cardPath)
  const { errors, warnings } = validateCard(card)
  if (errors.length) throw new Error(`fix the card first:\n- ${errors.join('\n- ')}`)
  warnings.forEach((w) => log(`warning: ${w}`))
  const allSecrets = [...card.runners.map((r) => r.token), ...sourcesOf(card).map((s) => s.readToken), ...Object.values(card.secrets ?? {}), card.results?.identity]
  const say = (m) => log(redact(m, allSecrets))

  if (!card.results?.identity) {
    if (dry) say('DRY: would create the result key pair and write it into the card (results.identity / results.recipient)')
    else {
      const k = generateKeys()
      card = updateCard(cardPath, (c) => { c.results = { ...(c.results ?? {}), identity: k.identity, recipient: k.recipient } })
      allSecrets.push(k.identity)
      say('created the result key pair: private key in the card (results.identity), public key goes to every runner')
    }
  }
  const recipient = card.results?.identity ? recipientOf(card.results.identity) : '(new key)'
  const sources = sourcesOf(card)
  const allowed = sources.map((s) => s.repo).join(',')

  // the code pushed to every runner = the committed HEAD of this qa-fleet checkout
  const g = (...a) => exec('git', a, { cwd: toolDir })
  const head = g('rev-parse', 'HEAD').stdout?.trim()
  if (!head) throw new Error(`${toolDir} is not a git checkout of qa-fleet`)
  if (g('status', '--porcelain').stdout?.trim() && !dry) throw new Error(`${toolDir} has uncommitted changes: the runners get the committed HEAD, commit first`)

  const report = []
  for (const r of card.runners.filter((x) => x.enabled !== false && (!only?.length || only.includes(x.owner)))) {
    const repo = `${r.owner}/${r.repo ?? DEFAULT_REPO}`
    const req = api(r.token, { fetchImpl })
    const row = { runner: repo, steps: [], problems: [] }
    report.push(row)
    const step = (m) => { row.steps.push(m); say(`  ${repo}: ${m}`) }
    const problem = (m) => { row.problems.push(m); say(`  ${repo}: PROBLEM ${m}`) }
    say(`==> ${repo}`)
    let info
    try { info = await req('GET', `/repos/${repo}`) } catch (e) {
      problem(e.status === 404 || e.status === 401 || e.status === 403
        ? `cannot see the repo with its token (${e.status}). ${r.owner} must create an EMPTY PUBLIC repo "${r.repo ?? DEFAULT_REPO}" and a fine-grained PAT limited to it (see the card, part A)`
        : e.message)
      continue
    }
    if (info.private) { problem('the repo is PRIVATE: make it public (Actions minutes are free only on public repos)'); continue }

    // 1. code
    let remoteHead = null
    try { remoteHead = (await req('GET', `/repos/${repo}/branches/main`)).commit?.sha } catch (e) { if (e.status !== 404) { problem(e.message); continue } }
    if (r.self) step(remoteHead === head ? `code already at ${head.slice(0, 8)}` : `own repo: bootstrap does not push here, push main yourself (remote ${remoteHead?.slice(0, 8) ?? 'empty'}, local ${head.slice(0, 8)})`)
    else if (remoteHead === head) step(`code already at ${head.slice(0, 8)}`)
    else if (dry) step(`DRY: would push qa-fleet ${head.slice(0, 8)} to main${remoteHead ? ` (now ${remoteHead.slice(0, 8)})` : ' (empty repo)'}`)
    else {
      const p = exec('git', ['push', ...(forceTemplate ? ['--force'] : []), `https://github.com/${repo}.git`, `${head}:refs/heads/main`], { cwd: toolDir, env: gitAuthEnv(r.token) })
      if (p.status !== 0) { problem(`git push failed: ${redact(p.stderr, allSecrets).trim().split('\n').slice(-2).join(' ')}${/rejected|fetch first|non-fast-forward/.test(p.stderr) ? ' (the repo main has other commits, e.g. a README: empty it, or rerun with --force-template)' : ''}${/workflow/.test(p.stderr) ? ' (the token needs the Workflows: write permission)' : ''}`); continue }
      step(`pushed qa-fleet ${head.slice(0, 8)} to main`)
    }

    // 2. Actions on, GITHUB_TOKEN read-only
    if (dry) step('DRY: would enable Actions and set the default GITHUB_TOKEN to read-only')
    else {
      try { await req('PUT', `/repos/${repo}/actions/permissions`, { enabled: true, allowed_actions: 'all' }); step('Actions enabled') } catch (e) { say(`  ${repo}: note: could not change the Actions settings (${e.status}); fine if Actions is already on (token without Administration: write)`) }
      try { await req('PUT', `/repos/${repo}/actions/permissions/workflow`, { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false }); step('GITHUB_TOKEN read-only') } catch (e) { say(`  ${repo}: note: could not set the GITHUB_TOKEN default (${e.status}); the workflow sets permissions: contents: read itself`) }
    }

    // 3. variables (public values)
    for (const [name, value] of [['FLEET_RECIPIENT', recipient], ['ALLOWED_SOURCES', allowed]]) {
      if (dry) { step(`DRY: would set variable ${name}`); continue }
      try {
        try { await req('PATCH', `/repos/${repo}/actions/variables/${name}`, { name, value }) } catch (e) { if (e.status !== 404) throw e; await req('POST', `/repos/${repo}/actions/variables`, { name, value }) }
        step(`variable ${name} set`)
      } catch (e) { problem(`variable ${name}: ${e.message} (the token needs Variables: write)`) }
    }

    // 4. secrets (gh encrypts them with the repo public key)
    const secrets = { SOURCE_REPO_TOKEN: sources[0].readToken, ...Object.fromEntries(Object.entries(card.secrets ?? {}).filter(([, v]) => typeof v === 'string' && v.trim())) }
    if (sources.length > 1) say(`  ${repo}: note: SOURCE_REPO_TOKEN = the readToken of ${sources[0].repo}; for several sources give that token access to all of them`)
    for (const [name, value] of Object.entries(secrets)) {
      if (dry) { step(`DRY: would set secret ${name}`); continue }
      const s = exec('gh', ['secret', 'set', name, '--repo', repo], { env: { GH_TOKEN: r.token, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' }, input: value })
      if (s.error?.code === 'ENOENT') { problem('the GitHub CLI (gh) is not installed: it is needed to store secrets (https://cli.github.com)'); break }
      if (s.status !== 0) problem(`secret ${name}: ${redact(s.stderr, allSecrets).trim().split('\n').pop()} (the token needs Secrets: write)`)
      else step(`secret ${name} set`)
    }
  }
  return { dry, head, recipient, report, ok: report.length > 0 && report.every((x) => !x.problems.length) }
}

// --------------------------------------------------------------- source branch with the full tests
export async function findBranch({ card, cardPath, fetchImpl } = {}) {
  card ??= readCard(cardPath)
  const out = []
  for (const s of sourcesOf(card)) {
    const req = api(s.readToken, { fetchImpl })
    const markers = ['.qa-fleet/units.json', ...(s.markers ?? [])]
    const res = { source: s.name, repo: s.repo, checked: [], use: null }
    try { await req('GET', `/repos/${s.repo}`) } catch (e) { res.error = `cannot read ${s.repo} with readToken (${e.status ?? e.message}): the token needs Contents: read on it`; out.push(res); continue }
    for (const b of s.branches) {
      const c = { branch: b, exists: false, files: {} }
      try { c.sha = (await req('GET', `/repos/${s.repo}/branches/${encodeURIComponent(b)}`)).commit?.sha; c.exists = true } catch (e) { if (e.status !== 404) c.error = e.message }
      if (c.exists) for (const f of markers) { try { await req('GET', `/repos/${s.repo}/contents/${f}?ref=${encodeURIComponent(b)}`); c.files[f] = true } catch { c.files[f] = false } }
      c.state = !c.exists ? 'missing' : Object.values(c.files).every(Boolean) ? 'ready' : c.files['.qa-fleet/units.json'] ? 'partial (units.json, some markers missing)' : 'no fleet units (tests may exist, .qa-fleet/ is missing)'
      res.checked.push(c)
      if (!res.use && c.state === 'ready') res.use = b
    }
    res.next = res.use ? `run the tests of ${res.use} (card part C)` : res.checked.some((c) => c.exists) ? `extend the closest existing branch with .qa-fleet/ (card part D2)` : 'build the test branch from scratch (card part D)'
    out.push(res)
  }
  return out
}

export function checkout({ cardPath, source, branch, dir, exec = defaultExec } = {}) {
  const card = readCard(cardPath)
  const s = sourcesOf(card).find((x) => !source || x.name === source) ?? sourcesOf(card)[0]
  if (!s) throw new Error('no source in the card')
  branch ??= s.testBranch
  const env = gitAuthEnv(s.readToken)
  if (fs.existsSync(path.join(dir, '.git'))) {
    const f = exec('git', ['fetch', '--depth', '1', 'origin', branch], { cwd: dir, env })
    if (f.status !== 0) throw new Error(`git fetch failed: ${redact(f.stderr, [s.readToken])}`)
    const c = exec('git', ['checkout', '--force', '-B', branch, 'FETCH_HEAD'], { cwd: dir })
    if (c.status !== 0) throw new Error(`git checkout failed: ${c.stderr}`)
  } else {
    fs.mkdirSync(path.dirname(path.resolve(dir)), { recursive: true })
    const c = exec('git', ['clone', '--depth', '1', '--branch', branch, `https://github.com/${s.repo}.git`, dir], { env })
    if (c.status !== 0) throw new Error(`git clone failed: ${redact(c.stderr, [s.readToken])}`)
  }
  return { dir: path.resolve(dir), repo: s.repo, branch, sha: exec('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim() }
}
