// The coordinator: runs INSIDE .github/workflows/fleet.yml of the home repo. Its only credential is the GitHub App
// (vars.FLEET_APP_ID + environment secret FLEET_APP_PRIVATE_KEY). From that it:
//   1. discovers the runner repos (every allowed installation of the App on a repo named tests_runner*)
//   2. provisions them (stub workflow pinned to this commit, Actions on)
//   3. mints a 1-hour, read-only token for the source repo and copies it + the declared test secrets to each runner
//      (refreshed every 30 minutes while the run lasts, deleted at the end)
//   4. plans, dispatches, watches, retries infra once elsewhere, and bundles the SEALED results
// The coordinator never holds the result private key: `fleet pull` decrypts the bundle on the owner's PC.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { githubApp, discoverRunners } from './app.mjs'
import { provision, setSecrets, deleteSecrets } from './provision.mjs'
import { api } from './github.mjs'
import { checkRepo } from './config.mjs'
import { loadUnits, selectUnits } from './units.mjs'
import * as fleet from './fleet.mjs'

export const BUNDLE = 'fleet-bundle'
const NOT_TEST_SECRETS = /^(github_token|FLEET_APP_PRIVATE_KEY|PERSONAL_REPO_TOKEN|SOURCE_REPO_TOKEN)$/i

// the source's .qa-fleet/ (units.json, timings.json) at ref, through the contents API
export async function fetchUnits({ source, ref, token, dir, fetchImpl }) {
  const req = api(token, { fetchImpl, label: 'source' })
  fs.mkdirSync(path.join(dir, '.qa-fleet'), { recursive: true })
  for (const [f, required] of [['units.json', true], ['timings.json', false]]) {
    try {
      const j = await req('GET', `/repos/${source}/contents/.qa-fleet/${f}?ref=${encodeURIComponent(ref)}`)
      fs.writeFileSync(path.join(dir, '.qa-fleet', f), Buffer.from(j.content ?? '', j.encoding === 'base64' ? 'base64' : 'utf8'))
    } catch (e) { if (required) throw new Error(`cannot read .qa-fleet/${f} of ${source}@${ref} (${e.status ?? e.message}): push the test branch first`) }
  }
  return dir
}

export async function coordinate({ mode = 'run', appId, pem, home, sha, accounts = [], source, ref, only, tags, recipient, testSecrets = {}, outDir, fetchImpl, exec, pollMs, retryWaitMs, log = console.error, write = (s) => process.stdout.write(s) } = {}) {
  checkRepo('home repo', home)
  fs.mkdirSync(outDir, { recursive: true })
  const app = githubApp({ appId, pem, fetchImpl, onToken: (t) => write(`::add-mask::${t}\n`) })
  const runners = await discoverRunners(app, { home, accounts, log })
  const report = await provision({ runners, home, sha, fetchImpl, log })
  const ready = runners.filter((r) => report[r.repo]?.state === 'ready')
  const cfg = { runners: ready, outDir }
  if (mode === 'status' || mode === 'provision') {
    const st = mode === 'status' ? await fleet.status(cfg, { fetchImpl }) : null
    const view = { mode, home, runners: runners.map((r) => ({ repo: r.repo, self: r.self, ...report[r.repo], ...(st?.runners.find((x) => x.repo === r.repo) ?? {}) })), totalFreeSlots: st?.totalFreeSlots ?? null }
    fs.writeFileSync(path.join(outDir, 'status.json'), JSON.stringify(view, null, 1))
    return { mode, status: view, bundle: outDir }
  }
  if (!runners.length) throw new Error('no runner: install the fleet App on a repo named tests_runner (see docs/APP.md)')
  if (!ready.length) throw new Error(`no runner is ready: ${JSON.stringify(report)}`)
  checkRepo('source', source)

  // the source: a token that can only READ that one repo, for one hour
  const srcInst = await app.installationFor(source)
  const srcToken = (fresh) => app.token(srcInst, { repositories: [source.split('/')[1]], permissions: { contents: 'read' } }, { fresh })
  const projectDir = await fetchUnits({ source, ref, token: await srcToken(false), dir: fs.mkdtempSync(path.join(os.tmpdir(), 'qaf-src-')), fetchImpl })
  const chosen = selectUnits(loadUnits(projectDir).units, { only, tags })
  const names = [...new Set(chosen.flatMap((u) => u.secrets ?? []))].filter((n) => !NOT_TEST_SECRETS.test(n))
  const missing = names.filter((n) => testSecrets[n] == null)
  if (missing.length) log(`warning: the units declare secrets that the home repo does not have: ${missing.join(', ')} (add them: gh secret set <NAME> --env fleet)`)
  const values = Object.fromEntries(names.filter((n) => testSecrets[n] != null).map((n) => [n, testSecrets[n]]))
  const push = async () => { const t = await srcToken(true); for (const r of ready) await setSecrets({ runner: r, values: { SOURCE_REPO_TOKEN: t, ...values }, exec }) }
  await push()
  let last = Date.now()
  const onTick = async () => { if (Date.now() - last > 30 * 60000) { last = Date.now(); await push(); log('source token refreshed on the runners') } }

  // the workflow was cancelled: cancel the runner runs too
  const stop = async () => {
    try { for (const id of fs.readdirSync(outDir)) if (fs.existsSync(path.join(outDir, id, 'run.json'))) await fleet.cancel({ cfg, runId: id, fetchImpl }) } catch { /* best effort */ }
    process.exit(130)
  }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  try {
    const r = await fleet.runAll({ cfg, projectDir, source, ref, only, tags, recipient, sealed: true, fetchImpl, pollMs, retryWaitMs, onTick, log })
    const run = fleet.loadRun(cfg, r.runId)
    run.projectDir = null
    run.mode = 'coordinator'
    fleet.saveRun(cfg, run)
    return { runId: r.runId, bundle: fleet.runDir(cfg, r.runId), summary: r.summary }
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop)
    for (const r of ready) await deleteSecrets({ runner: r, names: ['SOURCE_REPO_TOKEN', ...Object.keys(values)], exec }).catch((e) => log(`${r.repo}: secrets not deleted: ${e.message}`))
    fs.rmSync(projectDir, { recursive: true, force: true })
  }
}
