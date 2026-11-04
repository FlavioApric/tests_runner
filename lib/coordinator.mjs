// The coordinator: the same plan -> dispatch -> watch -> collect cycle, run as a GitHub workflow in YOUR tests_runner
// repo (.github/workflows/coordinate.yml) instead of on your PC.
//
// Crypto, end to end:
//   - the card's json block (runner tokens + source readToken; never the test secrets, never the result key) is sealed
//     with X25519 + AES-256-GCM into the environment secret FLEET_CARD_SEALED; the opening key is FLEET_CARD_KEY.
//     Both live only in the GitHub Environment "fleet" (required reviewer = you, main only).
//   - the runners seal their results to FLEET_RECIPIENT. The coordinator has NO private result key: it only bundles
//     the sealed archives with public unit states. `fleet pull` decrypts the bundle on your PC.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateKeys, sealBuffer, openBuffer } from './crypto.mjs'
import { cardToConfig, sourcesOf, CARD_SCHEMA } from './card.mjs'
import { resolveSource, identityOf } from './config.mjs'
import { api } from './bootstrap.mjs'
import { client } from './github.mjs'
import { unzipToDir } from './zip.mjs'
import * as fleet from './fleet.mjs'

export const BUNDLE = 'fleet-bundle'

// only what the coordinator needs: runners (tokens), sources (read tokens), coordinator. No secrets{}, no result key.
export function coordinatorCard(card) {
  const { runners, source, sources, coordinator } = card
  return { card: CARD_SCHEMA, runners, ...(source ? { source } : {}), ...(sources ? { sources } : {}), ...(coordinator ? { coordinator } : {}) }
}

export function sealCard(card) {
  const k = generateKeys()
  return { sealed: sealBuffer(Buffer.from(JSON.stringify(coordinatorCard(card))), k.recipient), key: k.identity }
}

export const openSealedCard = (sealed, key) => JSON.parse(openBuffer(sealed, key).toString('utf8'))

export const tokensOf = (card) => [...(card.runners ?? []).map((r) => r.token), ...sourcesOf(card).map((s) => s.readToken)].filter((t) => typeof t === 'string' && t.length > 3)

// GitHub Actions masks: every token is hidden from the job log before anything else runs
export function mask(card, write = (s) => process.stdout.write(s)) {
  for (const t of tokensOf(card)) write(`::add-mask::${t}\n`)
}

// the source's .qa-fleet/ (units.json, timings.json) at ref, through the contents API with the read token
export async function fetchUnits({ cfg, source, ref, dir, fetchImpl }) {
  const repo = resolveSource(cfg, source)
  const s = Object.values(cfg.sources ?? {}).find((x) => x.repo === repo)
  if (!s?.readToken) throw new Error(`source ${repo} is not in the card (or has no readToken)`)
  const req = api(s.readToken, { fetchImpl })
  fs.mkdirSync(path.join(dir, '.qa-fleet'), { recursive: true })
  for (const [f, required] of [['units.json', true], ['timings.json', false]]) {
    try {
      const j = await req('GET', `/repos/${repo}/contents/.qa-fleet/${f}?ref=${encodeURIComponent(ref)}`)
      fs.writeFileSync(path.join(dir, '.qa-fleet', f), Buffer.from(j.content ?? '', j.encoding === 'base64' ? 'base64' : 'utf8'))
    } catch (e) { if (required) throw new Error(`cannot read .qa-fleet/${f} of ${repo}@${ref} (${e.status ?? e.message}): push the test branch first`) }
  }
  return dir
}

// runs INSIDE coordinate.yml. Returns the bundle directory (run.json, SUMMARY.md, sealed/<unit>.qaf).
export async function coordinate({ sealed, key, source, ref, only, tags, outDir, fetchImpl, pollMs, log = console.error, write } = {}) {
  if (!sealed || !key) throw new Error('FLEET_CARD_SEALED / FLEET_CARD_KEY are not set (environment "fleet": run  fleet bootstrap --coordinator)')
  const card = openSealedCard(sealed, key)
  mask(card, write)
  const cfg = cardToConfig(card, 'sealed card')
  cfg.outDir = outDir
  cfg.identity = null
  const projectDir = await fetchUnits({ cfg, source, ref, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'qaf-src-')), fetchImpl })
  const r = await fleet.runAll({ cfg, projectDir, source, ref, only, tags, sealed: true, fetchImpl, pollMs, log })
  const run = fleet.loadRun(cfg, r.runId)
  run.projectDir = null
  run.mode = 'coordinator'
  fleet.saveRun(cfg, run)
  return { runId: r.runId, bundle: fleet.runDir(cfg, r.runId), summary: r.summary }
}

const coordinatorClient = (cfg, fetchImpl) => {
  if (!cfg.coordinator?.token) throw new Error('the card has no coordinator (coordinator.repo = your tests_runner repo, also listed in runners[])')
  return client(cfg.coordinator, { fetchImpl })
}

// from your PC: start coordinate.yml. GitHub then waits for your approval of the "fleet" environment.
export async function viaCoordinator({ cfg, source, ref, only, tags, fetchImpl }) {
  const c = coordinatorClient(cfg, fetchImpl)
  const id = await c.dispatch({ source, ref, only: (only ?? []).join(','), tags: (tags ?? []).join(',') })
  const url = id ? `https://github.com/${cfg.coordinator.repo}/actions/runs/${id}` : `https://github.com/${cfg.coordinator.repo}/actions/workflows/${cfg.coordinator.workflow}`
  return { ghRunId: id, url, next: `approve the "${cfg.coordinator.environment}" deployment at ${url}, then: fleet pull --gh-run ${id ?? '<run id>'}` }
}

// from your PC: download the coordinator bundle, decrypt every unit with the local private key, write the usual run folder
export async function pull({ cfg, ghRun, projectDir, fetchImpl, log = console.error }) {
  const c = coordinatorClient(cfg, fetchImpl)
  const st = await c.run(ghRun)
  if (st.status !== 'completed') throw new Error(`coordinator run ${ghRun} is ${st.status}: pull it when it has completed`)
  const art = (await c.artifacts(ghRun)).find((a) => a.name === BUNDLE && !a.expired)
  if (!art) throw new Error(`coordinator run ${ghRun} has no ${BUNDLE} artifact (expired after 3 days, or the run failed before dispatching)`)
  const identity = identityOf(cfg)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaf-bundle-'))
  try {
    const files = unzipToDir(await c.download(art.id), tmp)
    const runFile = files.find((f) => path.basename(f) === 'run.json')
    if (!runFile) throw new Error('the bundle has no run.json')
    const run = JSON.parse(fs.readFileSync(runFile, 'utf8'))
    const root = path.dirname(runFile)
    const dest = fleet.runDir(cfg, run.runId)
    for (const [u, r] of Object.entries(run.results)) {
      const job = run.batches.find((b) => b.batch === r.batch)?.jobs?.[u]
      if (!r.sealed) continue
      const dir = path.join(dest, 'units', u)
      try {
        const { meta, junit } = await fleet.openSealedInto(path.join(root, r.sealed), dir, identity)
        run.results[u] = fleet.decryptedResult(meta, junit, dir, job, { batch: r.batch, runner: r.runner, publicStatus: r.status })
      } catch (e) { log(`unit ${u}: cannot open results: ${e.message}`) }
    }
    run.ghCoordinatorRun = ghRun
    run.projectDir = projectDir ? path.resolve(projectDir) : null
    fleet.saveRun(cfg, run)
    fleet.writeTimings(run)
    const s = fleet.summary(run)
    fs.writeFileSync(path.join(dest, 'SUMMARY.md'), s.markdown)
    return { ...run, summary: s, summaryPath: path.join(dest, 'SUMMARY.md') }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

// one-time setup of the coordinator in YOUR tests_runner repo: Environment "fleet" (you as required reviewer, main only),
// the two environment secrets (through gh, value on stdin), variable FLEET_COORDINATOR=true. Token needs Environments: write.
export async function setupCoordinator({ card, dry = false, fetchImpl, exec, log = console.log }) {
  const co = cardToConfig(card, 'card').coordinator
  if (!co?.token) throw new Error('set coordinator.repo in the card (your tests_runner repo, also in runners[])')
  const req = api(co.token, { fetchImpl })
  const [owner] = co.repo.split('/')
  const problems = [], steps = []
  const step = (m) => { steps.push(m); log(`  ${co.repo}: ${m}`) }
  const { sealed, key } = sealCard(card)
  if (dry) {
    step(`DRY: would create environment "${co.environment}" (required reviewer ${owner}, branch main only), set its secrets FLEET_CARD_SEALED + FLEET_CARD_KEY and variable FLEET_COORDINATOR=true`)
    return { dry, problems, steps }
  }
  try {
    const user = await req('GET', `/users/${owner}`)
    await req('PUT', `/repos/${co.repo}/environments/${co.environment}`, { reviewers: [{ type: 'User', id: user.id }], prevent_self_review: false, deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } })
    step(`environment ${co.environment}: reviewer ${owner}`)
    try { await req('POST', `/repos/${co.repo}/environments/${co.environment}/deployment-branch-policies`, { name: 'main', type: 'branch' }) } catch (e) { if (e.status !== 303 && e.status !== 409 && e.status !== 422) throw e }
    step('deployments only from main')
  } catch (e) { problems.push(`environment: ${e.message} (the tests_runner token needs Environments: write and Administration: write)`); return { problems, steps } }
  for (const [name, value] of [['FLEET_CARD_SEALED', sealed], ['FLEET_CARD_KEY', key]]) {
    const s = exec('gh', ['secret', 'set', name, '--env', co.environment, '--repo', co.repo], { env: { GH_TOKEN: co.token, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' }, input: value })
    if (s.error?.code === 'ENOENT') { problems.push('the GitHub CLI (gh) is not installed'); break }
    if (s.status !== 0) problems.push(`secret ${name}: ${String(s.stderr ?? '').split(co.token).join('***').trim().split('\n').pop()}`)
    else step(`environment secret ${name} set`)
  }
  try {
    try { await req('PATCH', `/repos/${co.repo}/actions/variables/FLEET_COORDINATOR`, { name: 'FLEET_COORDINATOR', value: 'true' }) } catch (e) { if (e.status !== 404) throw e; await req('POST', `/repos/${co.repo}/actions/variables`, { name: 'FLEET_COORDINATOR', value: 'true' }) }
    step('variable FLEET_COORDINATOR=true')
  } catch (e) { problems.push(`variable FLEET_COORDINATOR: ${e.message}`) }
  return { problems, steps }
}

