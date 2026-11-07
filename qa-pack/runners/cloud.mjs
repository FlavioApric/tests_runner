// `pack.mjs flow --target cloud`: run the flow's fleet units on the cloud runners (the `fleet` skill / lib on the
// tests_runner main branch), fold the unit results into the SAME <paths.state>/state.json, write CLOUD_REPORT.md,
// then run the steps that have no fleet unit (gates, validation) locally with `flow --resume --only ...`.
//   node qa-pack/runners/pack.mjs flow --target cloud [--project <dir>] [--only step|unit,...] [--ref <branch>]
//        [--source <owner/repo>] [--dry]
// Env: QA_FLEET_DIR = a checkout of the fleet (tests_runner main: lib/local.mjs, lib/fleet.mjs, lib/units.mjs);
//      default ~/dev/tests_runner. The only credential is the gh CLI login: the fleet's coordinator workflow
//      (fleet.yml, driven by the fleet GitHub App) does the rest; this script starts it, waits and decrypts.
// Rules: a failed test is never retried (the fleet retries only infrastructure, once); gate steps never run in the
// cloud; nothing is invented: a step without a unit result keeps its previous state (or stays deferred).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { loadFlow } from '../lib/flow.mjs'
import { readJson, write, writeJson } from '../lib/util.mjs'

export const fleetDir = () => process.env.QA_FLEET_DIR || path.join(os.homedir(), 'dev', 'tests_runner')
const imp = (dir, f) => import(pathToFileURL(path.join(dir, 'lib', f)).href)

// unit results -> step status: any fail -> failed, else any infra -> deferred, else done
export function foldResults(units, results, steps) {
  const out = {}
  for (const s of steps) {
    const list = units.filter((u) => u.step === s.id && !u.agent && results[u.id]).map((u) => ({ u, res: results[u.id] }))
    if (!list.length) continue
    const fail = list.filter((x) => x.res.status === 'fail'), infra = list.filter((x) => x.res.status === 'infra')
    const note = (x) => `${x.u.id}: ${x.res.reason ?? x.res.status}${x.res.junit ? ` (${x.res.junit.failures + x.res.junit.errors}/${x.res.junit.tests} failed)` : ''}`
    const status = fail.length ? 'failed' : infra.length ? 'deferred' : 'done'
    out[s.id] = { status, exit: status === 'done' ? 0 : status === 'deferred' ? 3 : 1, units: list.map((x) => x.u.id), tail: [...fail, ...infra].map(note).join('\n'), ...(status === 'deferred' ? { missing: infra.map((x) => `cloud-infra: ${note(x)}`) } : {}) }
  }
  return out
}

export async function cloudFlow(cfg, a) {
  const FLEET = fleetDir()
  if (!fs.existsSync(path.join(FLEET, 'lib', 'fleet.mjs'))) { console.error(`cloud: fleet lib not found in ${FLEET} (set QA_FLEET_DIR to a tests_runner main checkout)`); return 3 }
  const fleet = await imp(FLEET, 'fleet.mjs'), { loadUnits } = await imp(FLEET, 'units.mjs'), local = await imp(FLEET, 'local.mjs')
  const projectDir = path.dirname(cfg.abs('fleet'))
  const { units } = loadUnits(projectDir)
  const steps = loadFlow(cfg).filter((s) => s.applies)
  const cloudSteps = new Set(units.filter((u) => !u.agent).map((u) => u.step))
  const localSteps = steps.filter((s) => !cloudSteps.has(s.id)).map((s) => s.id)
  const git = (...x) => spawnSync('git', x, { cwd: cfg.dir, encoding: 'utf8' }).stdout?.trim() ?? ''
  const ref = a.opt('--ref', git('rev-parse', '--abbrev-ref', 'HEAD'))
  const source = a.opt('--source', cfg.fleet.source ?? cfg.project)
  const only = a.opt('--only')?.split(','), dry = a.flag('--dry')
  if (!dry && !a.opt('--ref')) {
    const local = git('rev-parse', 'HEAD'), remote = git('rev-parse', `origin/${ref}`)
    if (!remote || local !== remote) { console.error(`cloud: the runners test the PUSHED ref: origin/${ref} is ${remote ? remote.slice(0, 8) : 'missing'}, local HEAD ${local.slice(0, 8)}. Push the test branch first, or pass --ref.`); return 3 }
  }
  console.log(`cloud flow: ${source}@${ref}, ${units.length} unit(s) in ${cfg.paths.fleet}/units.json; local steps: ${localSteps.join(', ') || 'none'}`)
  const printPlan = (p, note) => { for (const x of p.assignments) console.log(`> ${x.runner}: ${x.units.length} unit(s), about ${x.estWallMinutes} min: ${x.units.join(', ')}`); console.log(`estimated wall time ${p.estWallMinutes} min plus queueing${note}`) }
  if (dry) {
    const p = await fleet.makePlan({ cfg: { runners: [1, 2, 3].map((i) => ({ name: `runner-${i}`, maxParallel: 20 })) }, projectDir, only })
    printPlan(p, ' (offline plan, 3 runners x 20 slots assumed: node <fleet>/cli/fleet.mjs runners shows the real ones)')
    return 0
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(source ?? '')) { console.error(`cloud: --source (or fleet.source in qa.config.json) must be owner/repo, got "${source}"`); return 2 }
  let r
  try {
    const start = local.startRemote({ source, ref, only: only ?? [] })
    console.log(`  coordinator: ${start.url}`)
    await local.waitRemote(start.ghRunId, { log: (m) => console.log(`  ${m}`) })
    r = await local.pull({ ghRun: start.ghRunId, projectDir, log: (m) => console.log(`  ${m}`) })
    r.wallMinutes = r.wallMinutes ?? '?'
  } catch (e) { console.error(`cloud: ${e.message}\nThe fleet is not ready (node <fleet>/cli/fleet.mjs runners): run the flow locally.`); return 3 }

  const sp = path.join(cfg.abs('state'), 'state.json')
  const state = fs.existsSync(sp) ? readJson(sp) : { schema: 'qa-pack/state@1', steps: {} }
  const at = new Date().toISOString()
  for (const [id, v] of Object.entries(foldResults(units, r.results, steps))) state.steps[id] = { ...v, at, target: 'cloud', run: r.runId }
  writeJson(sp, state)
  const explore = Object.entries(r.results).filter(([u]) => u.startsWith('explore-')).map(([u, x]) => `| ${u} | ${x.status} |`)
  write(path.join(cfg.abs('state'), 'CLOUD_REPORT.md'), [r.summary.markdown, ...(explore.length ? ['', '## Explorers', '', '| Unit | Result |', '|---|---|', ...explore] : []), '', `Decrypted results (local only, outside the repo): ${path.dirname(r.summaryPath)}`, `Wall time: ${r.wallMinutes} min`, ''].join('\n'))
  console.log(`\ncloud: pass ${r.summary.pass}, fail ${r.summary.fail}, infra ${r.summary.infra} in ${r.wallMinutes} min. Report ${cfg.paths.state}/CLOUD_REPORT.md`)
  if (only || !localSteps.length) return r.summary.fail ? 1 : r.summary.infra ? 3 : 0
  console.log(`\nlocal steps: ${localSteps.join(', ')}`)
  const pack = path.join(import.meta.dirname, 'pack.mjs')
  const loc = spawnSync(process.execPath, [pack, 'flow', '--project', cfg.dir, '--resume', '--only', localSteps.join(',')], { cwd: cfg.dir, stdio: 'inherit' })
  return r.summary.fail ? 1 : (loc.status ?? 1)
}
