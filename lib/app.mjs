// The fleet's only credential: a GitHub App owned by the tests_runner owner.
// - The App's private key lives only in the "fleet" environment of the home repo (secret FLEET_APP_PRIVATE_KEY).
// - Every other account lends its runner repo by INSTALLING the App on it (one click, no token).
// - Tokens are minted per use: 1 hour, narrowed to one repository and the permissions the step needs.
import crypto from 'node:crypto'
import { api, paginate } from './github.mjs'

const b64u = (b) => Buffer.from(b).toString('base64url')

// RS256 JWT that authenticates as the App itself (10 minutes max, 60 s of clock skew allowed)
export function appJwt(appId, pem, now = Date.now()) {
  const iat = Math.floor(now / 1000) - 60
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify({ iat, exp: iat + 540, iss: String(appId) }))
  return `${head}.${body}.${b64u(crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), pem))}`
}

export function githubApp({ appId, pem, fetchImpl, onToken = () => {} }) {
  if (!appId || !pem) throw new Error('FLEET_APP_ID / FLEET_APP_PRIVATE_KEY are not set: run  node cli/fleet.mjs setup-app  once on your PC')
  const asApp = api(() => appJwt(appId, pem), { fetchImpl, label: 'app' })
  const cache = new Map()

  // installation token, optionally narrowed: { repositories: ['name'], permissions: { contents: 'read' } }
  async function token(installationId, narrow, { fresh = false } = {}) {
    const key = `${installationId}|${JSON.stringify(narrow ?? {})}`
    const c = cache.get(key)
    if (!fresh && c && c.exp - Date.now() > 10 * 60000) return c.token
    const r = await asApp('POST', `/app/installations/${installationId}/access_tokens`, narrow ?? {})
    onToken(r.token)
    cache.set(key, { token: r.token, exp: Date.parse(r.expires_at) || Date.now() + 3600000 })
    return r.token
  }
  const installations = () => paginate(asApp, '/app/installations', null)
  const reposOf = (installationId) => paginate(api(() => token(installationId), { fetchImpl, label: 'installation' }), '/installation/repositories', 'repositories')
  async function installationFor(repo) {
    try { return (await asApp('GET', `/repos/${repo}/installation`)).id }
    catch (e) { if (e.status === 404) throw new Error(`the fleet App is not installed on ${repo}: install it there (Settings → GitHub Apps, or the install link from  fleet setup-app)`); throw e }
  }
  return { token, installations, reposOf, installationFor, info: () => asApp('GET', '/app') }
}

// Runners = every repo the App is installed on whose name matches the pattern, on an allowed account.
// The home repo's owner is always allowed; other accounts must be listed (vars.FLEET_ACCOUNTS): a public App can be
// installed by anyone, and a stranger's repo must never receive the source token.
// Token runners: accounts that cannot (or will not) install the App lend ONE repo with ONE fine-grained token, stored as the
// environment secret FLEET_RUNNER_TOKENS = [{"repo":"owner/tests_runner","token":"..."}]. Same rules, same code path.
export function parseRunnerTokens(text) {
  if (!text) return []
  const list = JSON.parse(text)
  if (!Array.isArray(list)) throw new Error('FLEET_RUNNER_TOKENS must be a JSON array of {repo, token}')
  return list.map((e) => {
    if (!/^[A-Za-z0-9_.-]+\/tests_runner[A-Za-z0-9_.-]*$/i.test(e?.repo ?? '')) throw new Error(`FLEET_RUNNER_TOKENS: bad repo "${e?.repo}" (must be owner/tests_runner*)`)
    if (typeof e.token !== 'string' || e.token.length < 20) throw new Error(`FLEET_RUNNER_TOKENS: no token for ${e.repo}`)
    return { repo: e.repo, token: e.token }
  })
}

export async function discoverRunners(app, { home, accounts = [], tokens = [], pattern = /^tests_runner/i, maxParallel = 20, log = () => {} } = {}) {
  const owner = home.split('/')[0].toLowerCase()
  const allowed = new Set([owner, ...accounts.map((a) => a.toLowerCase())])
  const out = []
  for (const inst of await app.installations()) {
    const login = inst.account?.login ?? ''
    if (inst.suspended_at) { log(`installation on ${login} is suspended: skipped`); continue }
    if (!allowed.has(login.toLowerCase())) { log(`installation on ${login} ignored: not in FLEET_ACCOUNTS (node cli/fleet.mjs allow ${login})`); continue }
    for (const r of await app.reposOf(inst.id)) {
      if (!pattern.test(r.name) || r.archived) continue
      const self = r.full_name.toLowerCase() === home.toLowerCase()
      out.push({
        name: r.full_name, repo: r.full_name, installationId: inst.id, private: !!r.private, self,
        maxParallel: self ? maxParallel - 1 : maxParallel, // the home repo also runs the coordinator job
        workflow: 'shard.yml', branch: r.default_branch || 'main',
        auth: () => app.token(inst.id, { repositories: [r.name] }),
      })
    }
  }
  for (const t of tokens) {
    if (out.some((r) => r.repo.toLowerCase() === t.repo.toLowerCase())) { log(`${t.repo}: already reached through the App, token ignored`); continue }
    out.push({ name: t.repo, repo: t.repo, installationId: null, viaToken: true, private: false, self: false, maxParallel, workflow: 'shard.yml', branch: 'main', auth: () => t.token })
  }
  return out.sort((a, b) => Number(b.self) - Number(a.self) || a.repo.localeCompare(b.repo))
}
