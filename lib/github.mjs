// Thin GitHub REST client, one token per runner repo. fetch only, no gh CLI needed.
import { tokenOf } from './config.mjs'

const API = process.env.QA_FLEET_GITHUB_API || 'https://api.github.com'

export function client(runner, { fetchImpl = globalThis.fetch } = {}) {
  const token = tokenOf(runner)
  const [owner, repo] = runner.repo.split('/')
  const base = `${API}/repos/${owner}/${repo}`
  async function req(method, url, body, { raw = false, ok = [200, 201, 202, 204] } = {}) {
    const r = await fetchImpl(url.startsWith('http') ? url : `${base}${url}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'qa-fleet', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'follow',
    })
    if (!ok.includes(r.status)) {
      const t = await r.text().catch(() => '')
      throw Object.assign(new Error(`${runner.name}: ${method} ${url} -> ${r.status} ${t.slice(0, 200)}`), { status: r.status })
    }
    if (raw) return Buffer.from(await r.arrayBuffer())
    if (r.status === 204) return null
    const text = await r.text()
    return text ? JSON.parse(text) : null
  }
  const all = async (url, key) => { const out = []; for (let page = 1; page < 20; page++) { const j = await req('GET', `${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`); out.push(...(j[key] ?? [])); if ((j[key] ?? []).length < 100) break } return out }

  return {
    runner,
    async dispatch(inputs) {
      const r = await req('POST', `/actions/workflows/${runner.workflow}/dispatches`, { ref: runner.branch, inputs, return_run_details: true })
      return r?.workflow_run_id ?? null
    },
    async findRun(title, sinceIso) {
      const runs = await all(`/actions/workflows/${runner.workflow}/runs?event=workflow_dispatch&created=${encodeURIComponent('>=' + sinceIso)}`, 'workflow_runs')
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
    async names(kind) { try { return (await all(`/actions/${kind}`, kind)).map((x) => x.name) } catch (e) { return e.status === 403 || e.status === 404 ? null : Promise.reject(e) } },
    async repoInfo() { return req('GET', '') },
  }
}
