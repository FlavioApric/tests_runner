// Thin GitHub REST client (fetch only). Auth is a token string or an async function that returns one
// (GitHub App installation tokens are minted and refreshed on demand, see lib/app.mjs).
const API = () => process.env.QA_FLEET_GITHUB_API || 'https://api.github.com'

export function api(auth, { fetchImpl = globalThis.fetch, label = 'github' } = {}) {
  return async function req(method, url, body, { raw = false, ok = [200, 201, 202, 204] } = {}) {
    const token = typeof auth === 'function' ? await auth() : auth
    const r = await fetchImpl(url.startsWith('http') ? url : `${API()}${url}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'tests_runner', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'follow',
    })
    if (!ok.includes(r.status)) {
      const t = await r.text().catch(() => '')
      throw Object.assign(new Error(`${label}: ${method} ${url.replace(/\?.*$/, '')} -> ${r.status} ${t.slice(0, 200)}`), { status: r.status })
    }
    if (raw) return Buffer.from(await r.arrayBuffer())
    if (r.status === 204) return null
    const text = await r.text()
    return text ? JSON.parse(text) : null
  }
}

export async function paginate(req, url, key) {
  const out = []
  for (let page = 1; page < 50; page++) {
    const j = await req('GET', `${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    const items = Array.isArray(j) ? j : (j?.[key] ?? [])
    out.push(...items)
    if (items.length < 100) break
  }
  return out
}

// one runner repo: { name, repo: 'owner/name', auth|token, workflow, branch, maxParallel }
export function client(runner, { fetchImpl } = {}) {
  const req0 = api(runner.auth ?? runner.token, { fetchImpl, label: runner.name ?? runner.repo })
  const base = `/repos/${runner.repo}`
  const req = (m, u, b, o) => req0(m, u.startsWith('http') ? u : `${base}${u}`, b, o)
  const all = (u, key) => paginate(req, u, key)
  const workflow = runner.workflow ?? 'shard.yml'
  return {
    runner,
    req,
    async dispatch(inputs) {
      const r = await req('POST', `/actions/workflows/${workflow}/dispatches`, { ref: runner.branch ?? 'main', inputs, return_run_details: true })
      return r?.workflow_run_id ?? null
    },
    async findRun(title, sinceIso) {
      const runs = await all(`/actions/workflows/${workflow}/runs?event=workflow_dispatch&created=${encodeURIComponent('>=' + sinceIso)}`, 'workflow_runs')
      return runs.find((x) => x.display_title === title)?.id ?? null
    },
    run: (id) => req('GET', `/actions/runs/${id}`),
    jobs: (id) => all(`/actions/runs/${id}/jobs?filter=latest`, 'jobs'),
    artifacts: (id) => all(`/actions/runs/${id}/artifacts`, 'artifacts'),
    download: (artifactId) => req('GET', `/actions/artifacts/${artifactId}/zip`, null, { raw: true }),
    cancel: (id) => req('POST', `/actions/runs/${id}/cancel`, null, { ok: [202, 409] }),
    async busyJobs() {
      let n = 0
      for (const status of ['in_progress', 'queued']) {
        const runs = await all(`/actions/runs?status=${status}`, 'workflow_runs')
        for (const r of runs) n += (await all(`/actions/runs/${r.id}/jobs?filter=latest`, 'jobs')).filter((j) => j.status !== 'completed').length
      }
      return n
    },
    repoInfo: () => req('GET', ''),
    // a text file on the default branch, or null (missing file, or empty repo)
    async getFile(p) {
      try { const j = await req('GET', `/contents/${p}`); return { sha: j.sha, text: Buffer.from(j.content ?? '', 'base64').toString('utf8') } }
      catch (e) { if (e.status === 404 || e.status === 409) return null; throw e }
    },
    putFile: (p, text, message, sha) => req('PUT', `/contents/${p}`, { message, content: Buffer.from(text).toString('base64'), ...(sha ? { sha } : {}) }),
  }
}
