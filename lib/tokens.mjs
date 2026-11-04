// `fleet tokens`: what each token of the card can do, read back from GitHub with read-only calls. Never prints a token.
import { sourcesOf, DEFAULT_REPO, coordinatorOf } from './card.mjs'

const API = () => process.env.QA_FLEET_GITHUB_API || 'https://api.github.com'

async function probe(token, url, fetchImpl) {
  const r = await fetchImpl(`${API()}${url}`, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'qa-fleet' } })
  let body = null
  try { body = await r.json() } catch { /* empty */ }
  return { ok: r.status >= 200 && r.status < 300, status: r.status, body, expires: r.headers.get('github-authentication-token-expiration') }
}

// needed = what docs/PERMISSIONS.md asks for. Read-only probes confirm READ access; write access is never probed (it would change the repo)
export async function tokenReport({ card, fetchImpl = globalThis.fetch } = {}) {
  const co = coordinatorOf(card)
  const out = []
  for (const r of (card.runners ?? []).filter((x) => x.enabled !== false)) {
    const repo = `${r.owner}/${r.repo ?? DEFAULT_REPO}`
    const row = { token: `runner ${repo}`, checks: {}, problems: [] }
    out.push(row)
    if (!r.token) { row.problems.push('no token'); continue }
    const info = await probe(r.token, `/repos/${repo}`, fetchImpl)
    row.expires = info.expires ?? 'no expiry header (classic token or no expiry: prefer a fine-grained token with an expiry)'
    if (!info.ok) { row.problems.push(`cannot see ${repo} (${info.status}): the token must be limited to that repo`); continue }
    row.checks.metadata = 'read'
    row.checks.contents = 'readable (write not probed: bootstrap fails clearly if it is missing)'
    for (const [k, url] of [['actions', `/repos/${repo}/actions/runs?per_page=1`], ['secrets', `/repos/${repo}/actions/secrets`], ['variables', `/repos/${repo}/actions/variables`], ['workflows', `/repos/${repo}/actions/workflows`]]) {
      const p = await probe(r.token, url, fetchImpl)
      row.checks[k] = p.ok ? 'readable (write not probed)' : `MISSING (${p.status})`
      if (!p.ok) row.problems.push(`${k}: needs Read and write`)
    }
    if (co && co.repo.toLowerCase() === repo.toLowerCase()) {
      const p = await probe(r.token, `/repos/${repo}/environments`, fetchImpl)
      row.checks.environments = p.ok ? 'readable (write not probed)' : `MISSING (${p.status})`
      if (!p.ok) row.problems.push('environments: the coordinator token needs Environments: Read and write')
    }
  }
  for (const s of sourcesOf(card)) {
    const row = { token: `source ${s.repo} (readToken)`, checks: {}, problems: [] }
    out.push(row)
    if (!s.readToken) { row.problems.push('no readToken'); continue }
    const info = await probe(s.readToken, `/repos/${s.repo}`, fetchImpl)
    row.expires = info.expires ?? 'no expiry header'
    if (!info.ok) { row.problems.push(`cannot read ${s.repo} (${info.status}): needs Contents: Read on it`); continue }
    row.checks.contents = 'readable (keep this token Contents: Read only)'
  }
  return out
}
