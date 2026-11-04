// Orchestration: status -> plan -> dispatch -> watch -> collect (+ one infra retry). Used by the CLI and the MCP server.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadConfig, resolveSource, publicView, tokenOf, identityOf } from './config.mjs'
import { loadUnits, selectUnits } from './units.mjs'
import { plan } from './planner.mjs'
import { client } from './github.mjs'
import { openFile } from './crypto.mjs'
import { unzipToDir } from './zip.mjs'
import { summarizeDir } from './junit.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const INFRA_EXIT = 75 // EX_TEMPFAIL: the unit says "my environment broke, not the tests"
const INFRA_PHASES = new Set(['prepare', 'emulator', 'checkout', 'lost'])
const TAR = process.platform === 'win32' && fs.existsSync('C:\\Windows\\System32\\tar.exe') ? 'C:\\Windows\\System32\\tar.exe' : 'tar'
const newRunId = () => `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`
const runDir = (cfg, id) => path.join(cfg.outDir, id)
const saveRun = (cfg, r) => { fs.mkdirSync(runDir(cfg, r.runId), { recursive: true }); fs.writeFileSync(path.join(runDir(cfg, r.runId), 'run.json'), JSON.stringify(r, null, 1)) }
export { saveRun, runDir }
export const loadRun = (cfg, id) => JSON.parse(fs.readFileSync(path.join(runDir(cfg, id), 'run.json'), 'utf8'))

export async function status(cfg = loadConfig(), { fetchImpl } = {}) {
  const view = publicView(cfg)
  for (const r of view.runners) {
    const runner = cfg.runners.find((x) => x.name === r.name)
    if (!tokenOf(runner)) { r.state = 'no token'; continue }
    try {
      const c = client(runner, { fetchImpl })
      const info = await c.repoInfo()
      r.visibility = info.private ? 'PRIVATE (minutes are billed: make it public)' : 'public'
      r.busyJobs = await c.busyJobs()
      r.freeSlots = Math.max(0, runner.maxParallel - r.busyJobs)
      const secrets = await c.names('secrets'), vars = await c.names('variables')
      r.secrets = secrets ?? 'not readable with this token'
      r.missing = [...(secrets && !secrets.includes('SOURCE_REPO_TOKEN') ? ['secret SOURCE_REPO_TOKEN'] : []), ...(vars && !vars.includes('FLEET_RECIPIENT') ? ['variable FLEET_RECIPIENT'] : []), ...(vars && !vars.includes('ALLOWED_SOURCES') ? ['variable ALLOWED_SOURCES'] : [])]
      r.state = r.missing.length ? 'incomplete setup' : 'ready'
    } catch (e) { r.state = `error: ${e.message.slice(0, 160)}` }
  }
  view.totalFreeSlots = view.runners.reduce((a, r) => a + (r.freeSlots ?? 0), 0)
  return view
}

function timingsOf(projectDir) { const p = path.join(projectDir, '.qa-fleet', 'timings.json'); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {} }

export async function makePlan({ cfg = loadConfig(), projectDir, only, tags, runnersState } = {}) {
  const { units } = loadUnits(projectDir)
  const chosen = selectUnits(units, { only, tags })
  if (!chosen.length) throw new Error('no unit selected')
  const runners = cfg.runners.filter((r) => r.enabled !== false).map((r) => ({ ...r, freeSlots: runnersState?.find((x) => x.name === r.name)?.freeSlots ?? r.maxParallel }))
  return { ...plan(chosen, runners, { timings: timingsOf(projectDir) }), selected: chosen.map((u) => u.id) }
}

async function dispatchBatch(cfg, run, a, label, { fetchImpl }) {
  const runner = cfg.runners.find((r) => r.name === a.runner)
  const c = client(runner, { fetchImpl })
  const batch = `${label}-${a.runner.replace(/[^\w.-]/g, '_')}`
  const since = new Date(Date.now() - 60000).toISOString()
  const inputs = { run_id: run.runId, batch, source: run.source, ref: run.ref, units: a.units.join(','), max_parallel: String(runner.maxParallel) }
  let ghRunId = await c.dispatch(inputs)
  for (let i = 0; !ghRunId && i < 15; i++) { await sleep(4000); ghRunId = await c.findRun(`fleet ${run.runId} ${batch}`, since) }
  const b = { batch, runner: a.runner, units: a.units, ghRunId, url: ghRunId ? `https://github.com/${runner.repo}/actions/runs/${ghRunId}` : null, status: ghRunId ? 'dispatched' : 'lost' }
  run.batches.push(b)
  return b
}

export async function dispatch({ cfg = loadConfig(), projectDir, source, ref, only, tags, dry = false, fetchImpl, log = console.log } = {}) {
  const repo = resolveSource(cfg, source)
  const st = await status(cfg, { fetchImpl })
  const ready = st.runners.filter((r) => r.state === 'ready')
  if (!ready.length) throw new Error(`no runner is ready: ${st.runners.map((r) => `${r.name}: ${r.state}`).join('; ')}`)
  const usable = { ...cfg, runners: cfg.runners.filter((r) => ready.some((x) => x.name === r.name)) }
  const p = await makePlan({ cfg: usable, projectDir, only, tags, runnersState: st.runners })
  if (dry) return { dry: true, plan: p, status: st }
  const run = { runId: newRunId(), source: repo, ref, projectDir: path.resolve(projectDir), created: new Date().toISOString(), plan: p, batches: [], results: {} }
  for (const a of p.assignments) { const b = await dispatchBatch(usable, run, a, 'b', { fetchImpl }); log(`dispatched ${b.units.length} unit(s) to ${b.runner}${b.url ? `: ${b.url}` : ' (run id not found yet)'}`) }
  saveRun(cfg, run)
  return run
}

export async function watch({ cfg = loadConfig(), runId, pollMs = 20000, timeoutMin, fetchImpl, log = console.log } = {}) {
  const run = loadRun(cfg, runId)
  const deadline = Date.now() + (timeoutMin ?? 400) * 60000
  for (;;) {
    let open = 0, done = 0, total = 0
    for (const b of run.batches.filter((x) => x.ghRunId && x.status !== 'completed')) {
      const c = client(cfg.runners.find((r) => r.name === b.runner), { fetchImpl })
      const r = await c.run(b.ghRunId)
      const jobs = (await c.jobs(b.ghRunId)).filter((j) => j.name.startsWith('u:'))
      b.jobs = Object.fromEntries(jobs.map((j) => [j.name.slice(2), { status: j.status, conclusion: j.conclusion, failedStep: j.steps?.find((s) => s.conclusion === 'failure')?.name ?? null, durationSec: j.started_at && j.completed_at ? Math.round((Date.parse(j.completed_at) - Date.parse(j.started_at)) / 1000) : null }]))
      if (r.status === 'completed') b.status = 'completed'
    }
    for (const b of run.batches) for (const u of b.units) { total++; const j = b.jobs?.[u]; if (b.status === 'completed' || j?.status === 'completed') done++; else open++ }
    saveRun(cfg, run)
    log(`[${new Date().toLocaleTimeString()}] ${done}/${total} units finished`)
    if (!open || run.batches.every((b) => b.status === 'completed' || !b.ghRunId)) return run
    if (Date.now() > deadline) { log('watch timeout'); return run }
    await sleep(pollMs)
  }
}

function classify(meta, job) {
  if (!meta) return { status: 'infra', reason: job ? `no result (job ${job.conclusion ?? job.status}${job.failedStep ? `, step "${job.failedStep}"` : ''})` : 'no result and no job' }
  if (meta.exitCode === INFRA_EXIT || INFRA_PHASES.has(meta.phase)) return { status: 'infra', reason: `${meta.phase} failed (exit ${meta.exitCode})` }
  return meta.exitCode === 0 ? { status: 'pass' } : { status: 'fail', reason: `${meta.phase} exit ${meta.exitCode}` }
}

// Sealed mode (the coordinator workflow has no private key): classify from the PUBLIC job data only.
// shard.yml fails the step "Infra failure" when the unit exits 75, and the step "Result" for any other non-zero exit.
export function publicClassify(job, hasArtifact) {
  if (!job) return { status: 'infra', reason: 'no job' }
  if (job.failedStep === 'Infra failure') return { status: 'infra', reason: 'the unit reported an infrastructure failure (exit 75)' }
  if (job.conclusion === 'success') return hasArtifact ? { status: 'pass' } : { status: 'infra', reason: 'passed but no sealed result' }
  if (job.conclusion === 'failure' && job.failedStep === 'Result') return { status: 'fail', reason: 'unit exit non-zero (details in the sealed log)' }
  return { status: 'infra', reason: `job ${job.conclusion ?? job.status}${job.failedStep ? `, step "${job.failedStep}"` : ''}` }
}

// decrypt one sealed archive into dir (replaces dir). Returns the unit meta and the JUnit summary.
export async function openSealedInto(encPath, dir, identity) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaf-'))
  try {
    const tgz = path.join(tmp, 'result.tgz')
    await openFile(encPath, tgz, identity)
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
    const t = spawnSync(TAR, ['-xzf', tgz, '-C', dir], { encoding: 'utf8' })
    if (t.status !== 0) throw new Error(`tar: ${t.stderr}`)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  const mp = path.join(dir, 'qa-fleet-meta', 'result.json')
  return { meta: fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf8')) : null, junit: summarizeDir(dir) }
}

export const junitView = (j) => (j && j.files ? { tests: j.tests, failures: j.failures, errors: j.errors, skipped: j.skipped, failed: j.failed.slice(0, 50) } : null)
export const decryptedResult = (meta, junit, dir, job, extra = {}) => ({ ...classify(meta, job), ...extra, durationSec: meta?.durationSec ?? job?.durationSec ?? null, exitCode: meta?.exitCode ?? null, phase: meta?.phase ?? null, junit: junitView(junit), dir: meta ? dir : null })

// sealed: keep the encrypted archives (coordinator workflow); otherwise decrypt with the local private key
export async function collect({ cfg = loadConfig(), runId, sealed = false, fetchImpl, log = console.log } = {}) {
  const run = loadRun(cfg, runId)
  const identity = sealed ? null : identityOf(cfg)
  const unitsDir = path.join(runDir(cfg, runId), 'units'), sealedDir = path.join(runDir(cfg, runId), 'sealed')
  const latest = {}
  for (const b of run.batches) for (const u of b.units) latest[u] = b.batch
  for (const b of run.batches) {
    if (!b.units.some((u) => latest[u] === b.batch && run.results[u]?.batch !== b.batch)) continue
    const c = b.ghRunId ? client(cfg.runners.find((r) => r.name === b.runner), { fetchImpl }) : null
    let arts = []
    if (c) { try { arts = await c.artifacts(b.ghRunId) } catch (e) { log(`artifacts of ${b.batch}: ${e.message}`) } }
    for (const u of b.units) {
      if (latest[u] !== b.batch || run.results[u]?.batch === b.batch) continue
      const art = arts.find((a) => a.name === `res-${runId}-${u}` && !a.expired)
      const job = b.jobs?.[u]
      let enc = null
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaf-'))
      try {
        if (art) {
          enc = unzipToDir(await c.download(art.id), tmp).find((f) => /\.(qaf|enc)$/.test(f)) ?? null
          if (!enc) log(`unit ${u}: artifact has no sealed file`)
        }
        if (sealed) {
          let kept = null
          if (enc) { fs.mkdirSync(sealedDir, { recursive: true }); fs.copyFileSync(enc, path.join(sealedDir, `${u}.qaf`)); kept = `sealed/${u}.qaf` }
          run.results[u] = { ...publicClassify(job, !!kept), batch: b.batch, runner: b.runner, durationSec: job?.durationSec ?? null, sealed: kept }
        } else {
          let meta = null, junit = null
          const dir = path.join(unitsDir, u)
          if (enc) { try { ({ meta, junit } = await openSealedInto(enc, dir, identity)) } catch (e) { log(`unit ${u}: cannot open results: ${e.message}`) } }
          run.results[u] = decryptedResult(meta, junit, dir, job, { batch: b.batch, runner: b.runner })
        }
      } catch (e) {
        log(`unit ${u}: ${e.message}`)
        run.results[u] = { status: 'infra', reason: `results not downloadable: ${e.message.slice(0, 120)}`, batch: b.batch, runner: b.runner }
      } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
    }
  }
  saveRun(cfg, run)
  return run
}

export function writeTimings(run) {
  if (!run.projectDir) return
  const p = path.join(run.projectDir, '.qa-fleet', 'timings.json')
  const t = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}
  for (const [u, r] of Object.entries(run.results)) if (r.durationSec && r.status !== 'infra') t[u] = Math.ceil(r.durationSec / 60)
  try { fs.writeFileSync(p, JSON.stringify(t, null, 1) + '\n') } catch { /* read-only project: timings are an optimisation */ }
}

export function summary(run) {
  const rs = Object.entries(run.results)
  const n = (s) => rs.filter(([, r]) => r.status === s).length
  const lines = [`# qa-fleet run ${run.runId}`, '', `Source ${run.source}@${run.ref}, ${rs.length} units: pass ${n('pass')}, fail ${n('fail')}, infra ${n('infra')}.`, '', '| Unit | Result | Runner | Minutes | Tests | Failed | Note |', '|---|---|---|---|---|---|---|']
  for (const [u, r] of rs.sort()) lines.push(`| ${u} | ${r.status} | ${r.runner} | ${r.durationSec ? Math.ceil(r.durationSec / 60) : ''} | ${r.junit?.tests ?? ''} | ${r.junit ? r.junit.failures + r.junit.errors : ''} | ${(r.reason ?? '').replaceAll('|', '/')} |`)
  lines.push('', 'Batches:', ...run.batches.map((b) => `- ${b.batch} (${b.units.length} units): ${b.url ?? 'run not found'}`))
  return { pass: n('pass'), fail: n('fail'), infra: n('infra'), total: rs.length, markdown: lines.join('\n') + '\n' }
}

// Full cycle. Infra failures are retried ONCE on another runner; test failures never are.
export async function runAll(opts) {
  const cfg = opts.cfg ?? loadConfig()
  const log = opts.log ?? console.log
  const t0 = Date.now()
  let run = await dispatch({ ...opts, cfg })
  if (run.dry) return run
  run = await watch({ cfg, runId: run.runId, pollMs: opts.pollMs, fetchImpl: opts.fetchImpl, log })
  run = await collect({ cfg, runId: run.runId, sealed: !!opts.sealed, fetchImpl: opts.fetchImpl, log })
  const infra = Object.entries(run.results).filter(([, r]) => r.status === 'infra').map(([u, r]) => ({ id: u, avoid: r.runner }))
  if (infra.length && opts.retryInfra !== false) {
    log(`retrying ${infra.length} unit(s) that failed for infrastructure reasons: ${infra.map((x) => x.id).join(', ')}`)
    const { units } = loadUnits(run.projectDir)
    const retry = units.filter((u) => infra.some((x) => x.id === u.id)).map((u) => ({ ...u, avoidRunners: [infra.find((x) => x.id === u.id).avoid] }))
    const p = plan(retry, cfg.runners.filter((r) => r.enabled !== false), { timings: timingsOf(run.projectDir) })
    for (const a of p.assignments) await dispatchBatch(cfg, run, a, 'retry', { fetchImpl: opts.fetchImpl })
    saveRun(cfg, run)
    run = await watch({ cfg, runId: run.runId, pollMs: opts.pollMs, fetchImpl: opts.fetchImpl, log })
    run = await collect({ cfg, runId: run.runId, sealed: !!opts.sealed, fetchImpl: opts.fetchImpl, log })
  }
  run.wallMinutes = Math.round((Date.now() - t0) / 600) / 100
  saveRun(cfg, run)
  if (!opts.sealed) writeTimings(run)
  const s = summary(run)
  fs.writeFileSync(path.join(runDir(cfg, run.runId), 'SUMMARY.md'), s.markdown)
  return { ...run, summary: s, summaryPath: path.join(runDir(cfg, run.runId), 'SUMMARY.md') }
}

export async function cancel({ cfg = loadConfig(), runId, fetchImpl } = {}) {
  const run = loadRun(cfg, runId)
  const out = []
  for (const b of run.batches.filter((x) => x.ghRunId && x.status !== 'completed')) { await client(cfg.runners.find((r) => r.name === b.runner), { fetchImpl }).cancel(b.ghRunId); out.push(b.batch) }
  return out
}
