// Keeps every runner repo ready, with the App's installation tokens only (no PAT, nothing to do by hand):
//   - .github/workflows/shard.yml = the stub (templates/runner-stub.yml) pinned to the home repo's commit
//   - Actions enabled, all actions and reusable workflows allowed
//   - per run: secrets SOURCE_REPO_TOKEN (1-hour, read-only, one repo) + the test secrets the units declare, deleted after
// The home repo is a runner too: its shard.yml is committed (calls ./shard-core.yml), so provision never pushes there.
import fs from 'node:fs'
import { client } from './github.mjs'
import { gh, defaultExec } from './gh.mjs'

export const STUB_PATH = '.github/workflows/shard.yml'

export function stubYaml({ home, sha }) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error(`stub needs the full commit sha of the home repo, got "${sha}"`)
  return fs.readFileSync(new URL('../templates/runner-stub.yml', import.meta.url), 'utf8').replaceAll('__HOME__', home).replaceAll('__SHA__', sha)
}

export async function provision({ runners, home, sha, fetchImpl, log = () => {} }) {
  const want = stubYaml({ home, sha })
  const report = {}
  for (const r of runners) {
    if (r.self) { report[r.repo] = { state: 'ready', note: 'home repo (committed shard.yml)' }; continue }
    const c = client(r, { fetchImpl })
    try {
      if (r.private) { report[r.repo] = { state: 'skipped', note: 'private repo: Actions minutes would be billed, make it public' }; continue }
      const have = await c.getFile(STUB_PATH)
      let changed = false
      if (have?.text !== want) {
        await c.putFile(STUB_PATH, want, `tests_runner: runner stub @ ${sha.slice(0, 7)}`, have?.sha)
        changed = true
      }
      try { await c.req('PUT', '/actions/permissions', { enabled: true, allowed_actions: 'all' }) }
      catch (e) { if (e.status !== 403 && e.status !== 409) throw e; log(`${r.repo}: cannot change the Actions settings (${e.status}); leaving them as they are`) }
      report[r.repo] = { state: 'ready', changed }
      log(`${r.repo}: ${changed ? 'stub updated' : 'up to date'}`)
    } catch (e) { report[r.repo] = { state: 'error', note: e.message.slice(0, 200) }; log(`${r.repo}: ${e.message}`) }
  }
  return report
}

export async function setSecrets({ runner, values, exec = defaultExec }) {
  const token = await runner.auth()
  for (const [name, value] of Object.entries(values)) gh(['secret', 'set', name, '--repo', runner.repo], { input: value, token, exec })
}

export async function deleteSecrets({ runner, names, exec = defaultExec }) {
  const token = await runner.auth()
  for (const name of names) { try { gh(['secret', 'delete', name, '--repo', runner.repo], { token, exec }) } catch { /* already gone */ } }
}
