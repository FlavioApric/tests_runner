#!/usr/bin/env node
// S6 mobile: runs the Maestro flows (qa.config mobile.maestro.flows) repeatedly on an Android emulator and keeps a
// RESUMABLE record. The series passes with `runs` GREEN runs since the last flow/app failure ON THE SAME ARTIFACT;
// it restarts from zero only when the artifact changes (fingerprint = APK sha256 + hash of the flows dir).
// Run classes: green | flow/app (a failure to investigate) | infra-hang (device stopped answering adb: an incident,
// never hidden) | infra-pre (device not ready before any flow ran: VOIDED and redone, recorded). Nothing is retried
// to turn a failure green.
//   node qa-pack/scripts/maestro-run.mjs [--project <dir>] [--runs N] [--resume | --fresh] [--max-total M]
//        [--device emulator-5554] [--timeout-min 20] [--dry-run]
// Env: MAESTRO_BIN, MAESTRO_PRERUN_CMD (shell, before each run), names in mobile.maestro.forwardEnv are passed to
// Maestro with -e (values never printed). Output in mobile.maestro.out: state.json, runs.jsonl, junit/, failures/, REPORT.md
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, projectDirFrom } from '../lib/config.mjs'
import { adbPath } from '../lib/flow.mjs'
import { args, read, write, walk, isMain } from '../lib/util.mjs'

export const sha256File = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null)
export const hashDir = (d) => { const h = crypto.createHash('sha256'); for (const f of walk(d)) h.update(path.relative(d, f).replace(/\\/g, '/')).update(fs.readFileSync(f)); return h.digest('hex') }
export const sameFingerprint = (a, b) => !!a && !!b && a.apk === b.apk && a.flows === b.flows

export function classifyRun({ exitCode, timedOut, junit, guestAlive, preFailed }) {
  if (preFailed) return 'infra-pre'
  if (exitCode === 0 && !timedOut && junit && junit.failures + junit.errors === 0 && junit.tests > 0) return 'green'
  if (timedOut || guestAlive === false) return 'infra-hang'
  if (!junit || junit.tests === 0) return 'infra-pre'
  return 'flow/app'
}

// green streak since the last flow/app or infra-hang run; voided (infra-pre) runs are skipped
export function computeStatus(runs, target) {
  let streak = 0
  for (const r of runs) { if (r.class === 'infra-pre') continue; streak = r.class === 'green' ? streak + 1 : 0 }
  return { executed: runs.filter((r) => r.class !== 'infra-pre').length, streak, target, pass: streak >= target, failures: runs.filter((r) => r.class === 'flow/app').length, hangs: runs.filter((r) => r.class === 'infra-hang').length }
}

export function junitCounts(file) {
  if (!fs.existsSync(file)) return null
  const xml = read(file), num = (re) => Number(xml.match(re)?.[1] ?? 0)
  return { tests: num(/<testsuite[^>]*?\btests="(\d+)"/), failures: num(/<testsuite[^>]*?\bfailures="(\d+)"/), errors: num(/<testsuite[^>]*?\berrors="(\d+)"/) }
}

if (isMain(import.meta.url)) {
  const a = args(), cfg = loadConfig(projectDirFrom()), m = cfg.mobile
  if (!m.enabled) { console.log('mobile.enabled is false in qa.config.json: nothing to run'); process.exit(0) }
  const RUNS = Number(a.opt('--runs', m.maestro.runs)), MAX = Number(a.opt('--max-total', RUNS * 2)), DRY = a.flag('--dry-run')
  const OUT = cfg.abs(m.maestro.out), FLOWS = cfg.abs(m.maestro.flows), APK = m.apk ? cfg.abs(m.apk) : null
  const MAESTRO = process.env.MAESTRO_BIN || 'maestro', ADB = adbPath(), DEVICE = a.opt('--device', '')
  const TIMEOUT = Number(a.opt('--timeout-min', 20)) * 60000, FORWARD = m.maestro.forwardEnv ?? []
  const fingerprint = { apk: APK && fs.existsSync(APK) ? sha256File(APK) : null, flows: hashDir(FLOWS) }
  const stateFile = path.join(OUT, 'state.json')
  let state = { schema: 'qa-pack/maestro@1', fingerprint, runs: [] }
  if (fs.existsSync(stateFile)) {
    const prev = JSON.parse(read(stateFile))
    if (!a.flag('--resume') && !a.flag('--fresh')) { console.error(`${cfg.rel(stateFile)} exists: pass --resume (same artifact) or --fresh (archive and restart)`); process.exit(2) }
    if (a.flag('--resume') && sameFingerprint(prev.fingerprint, fingerprint)) { state = prev; console.log(`resuming: ${prev.runs.length} run(s) on the same artifact`) }
    else if (!DRY) { const arch = `${OUT}-archive-${Date.now()}`; fs.renameSync(OUT, arch); console.log(`artifact changed or --fresh: old series moved to ${cfg.rel(arch)}`) }
  }
  const save = () => write(stateFile, JSON.stringify(state, null, 1) + '\n')
  const alive = () => !!spawnSync(ADB, ['shell', 'echo', 'alive'], { encoding: 'utf8', timeout: 10000 }).stdout?.includes('alive')
  let voids = 0
  for (;;) {
    const st = computeStatus(state.runs, RUNS)
    if (st.pass || st.executed >= MAX || voids >= 3) break
    const n = state.runs.length + 1, junit = path.join(OUT, 'junit', `run-${String(n).padStart(3, '0')}.xml`)
    const argv = [...(DEVICE ? ['--device', DEVICE] : []), 'test', '--format', 'junit', '--output', junit]
    if (m.maestro.includeTags) argv.push('--include-tags', m.maestro.includeTags)
    for (const k of FORWARD) if (process.env[k]) argv.push('-e', `${k}=${process.env[k]}`)
    argv.push(FLOWS)
    if (DRY) { console.log(`[dry-run] ${MAESTRO} ${argv.map((x) => (FORWARD.some((k) => x.startsWith(`${k}=`)) ? `${x.split('=')[0]}=***` : x)).join(' ')}\n[dry-run] fingerprint ${JSON.stringify(fingerprint)}; status ${JSON.stringify(st)}`); break }
    fs.mkdirSync(path.dirname(junit), { recursive: true })
    const preFailed = !alive()
    if (!preFailed && process.env.MAESTRO_PRERUN_CMD) spawnSync(process.env.MAESTRO_PRERUN_CMD, { cwd: cfg.dir, shell: true, stdio: 'ignore' })
    const t0 = Date.now()
    const r = preFailed ? { status: 1 } : spawnSync(MAESTRO, argv, { cwd: cfg.dir, stdio: ['ignore', 'inherit', 'inherit'], timeout: TIMEOUT, shell: process.platform === 'win32' })
    const timedOut = r.error?.code === 'ETIMEDOUT', counts = preFailed ? null : junitCounts(junit)
    const cls = classifyRun({ exitCode: r.status ?? 1, timedOut, junit: counts, guestAlive: r.status === 0 ? true : alive(), preFailed })
    const rec = { run: n, class: cls, exitCode: r.status ?? null, timedOut, durationMs: Date.now() - t0, flows: counts?.tests ?? null, junit: cfg.rel(junit), envNames: FORWARD.filter((k) => process.env[k]) }
    state.runs.push(rec); state.fingerprint = fingerprint; save()
    fs.appendFileSync(path.join(OUT, 'runs.jsonl'), JSON.stringify(rec) + '\n')
    if (cls !== 'green') {
      const dir = path.join(OUT, 'failures', `run-${String(n).padStart(3, '0')}`)
      write(path.join(dir, 'summary.json'), JSON.stringify(rec, null, 1))
      const lc = spawnSync(ADB, ['logcat', '-d', '-t', '300'], { encoding: 'utf8', timeout: 15000, maxBuffer: 16 << 20 })
      if (lc.stdout) write(path.join(dir, 'logcat.tail.txt'), lc.stdout.replace(/(password|token|apikey|secret)=\S+/gi, '$1=***'))
    }
    voids = cls === 'infra-pre' ? voids + 1 : 0
    console.log(`run ${n}: ${cls} (${Math.round(rec.durationMs / 1000)} s) streak ${computeStatus(state.runs, RUNS).streak}/${RUNS}`)
  }
  if (DRY) process.exit(0)
  const st = computeStatus(state.runs, RUNS)
  write(path.join(OUT, 'REPORT.md'), `# Maestro series (${cfg.project})\n\n- Target: ${RUNS} green in a row on the same artifact\n- Result: ${st.pass ? 'PASS' : 'NOT PASSED'} (streak ${st.streak}, executed ${st.executed}, flow/app failures ${st.failures}, hangs ${st.hangs})\n- Fingerprint: apk ${fingerprint.apk ?? 'n/a'}, flows ${fingerprint.flows}\n`)
  console.log(`series ${st.pass ? 'PASS' : 'NOT PASSED'}: ${JSON.stringify(st)}`)
  process.exit(st.pass ? 0 : 1)
}
