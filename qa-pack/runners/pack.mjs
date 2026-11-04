#!/usr/bin/env node
// qa-pack runner. Every command takes --project <dir> (or QA_PROJECT; default cwd) and reads <dir>/qa.config.json.
//   status                         modules by status, requirements, last flow
//   validate [--strict]            config, modules, cases, contracts (strict: no draft, no TODO(qa-pack), every requirement in a module)
//   new-module <slug> --name "..." --area <AREA> [--screen <screen>]
//   capabilities [--json]          what this machine can run (missing ones defer steps, never pass them)
//   flow [--dry] [--resume] [--only a,b] [--from id] [--target cloud]
//   run <step-id>                  one step (= flow --only <id>)
//   decisions [--check] [--seed]   decisions register (G1)
//   gate [G4] [--json]             gates of the active profiles
//   fleet-units [--check]          S7 cloud contract (scripts/fleet-units.mjs)
//   plans [--check]                S6 execution plans (scripts/plans.mjs)
// Exit codes: 0 green, 1 red, 2 usage/config, 3 deferred (something could not run here).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadConfig, projectDirFrom } from '../lib/config.mjs'
import { loadFlow, probeCaps, CAPS } from '../lib/flow.mjs'
import { PACK_DIR, args, read, readJson, write, writeJson, walk, render, slugify, isMain } from '../lib/util.mjs'
import { validateCases } from '../scripts/validate-cases.mjs'
import { validateContracts } from '../scripts/validate-contract.mjs'

export const MODULE_STATUSES = ['draft', 'authored', 'refined', 'compiled', 'green', 'accepted']
const atLeast = (s, min) => MODULE_STATUSES.indexOf(s) >= MODULE_STATUSES.indexOf(min)

// ------------------------------------------------------------------ modules
export function loadModules(cfg) {
  return walk(cfg.abs('modules'), (p) => path.basename(p) === 'module.json').map((p) => ({ file: cfg.rel(p), dir: path.dirname(p), ...readJson(p) }))
}

export function validateProject(cfg, { strict = false } = {}) {
  const errors = [], warnings = []
  const reqPath = cfg.abs('requirements')
  const reqs = fs.existsSync(reqPath) ? readJson(reqPath).requirements : null
  if (!reqs) (strict ? errors : warnings).push(`no ${cfg.paths.requirements} (S2 not done: run consolidate.mjs)`)
  const reqIds = new Set((reqs ?? []).map((r) => r.id))
  const areas = new Set(cfg.areas.map((a) => a.id))
  const mods = loadModules(cfg), seen = new Set()
  if (!mods.length) (strict ? errors : warnings).push(`no modules in ${cfg.paths.modules} (run pack.mjs new-module)`)
  for (const m of mods) {
    const at = m.file
    if (!cfg.isMod(m.id ?? '')) errors.push(`${at}: id "${m.id}" does not match ${cfg.ids.module}`)
    if (path.basename(m.dir) !== m.id) errors.push(`${at}: folder name must equal the id ${m.id}`)
    if (seen.has(m.id)) errors.push(`${at}: duplicate module id ${m.id}`); seen.add(m.id)
    if (!MODULE_STATUSES.includes(m.status)) errors.push(`${at}: status "${m.status}" not in ${MODULE_STATUSES.join(' -> ')}`)
    if (strict && m.status === 'draft') errors.push(`${at}: still draft (strict)`)
    if (m.area && !areas.has(m.area)) errors.push(`${at}: area ${m.area} is not in qa.config areas`)
    for (const c of m.cases ?? []) if (!fs.existsSync(path.join(cfg.dir, c))) errors.push(`${at}: case ${c} not found`)
    if (!(m.cases ?? []).length && atLeast(m.status ?? 'draft', 'authored')) errors.push(`${at}: an authored module needs at least one case`)
    for (const r of m.requirements ?? []) if (reqs && !reqIds.has(r)) errors.push(`${at}: requirement ${r} is not in ${cfg.paths.requirements}`)
    for (const s of m.designScreens ?? []) if (!fs.existsSync(path.join(cfg.abs('contracts'), `${s}.json`))) errors.push(`${at}: design screen ${s} has no contract`)
    for (const c of m.compiled ?? []) if (!fs.existsSync(path.join(cfg.dir, c))) errors.push(`${at}: compiled spec ${c} not found`)
    if (atLeast(m.status ?? 'draft', 'compiled') && !(m.compiled ?? []).length) errors.push(`${at}: status ${m.status} but no compiled spec listed`)
    for (const d of m.dependsOn ?? []) if (!mods.some((x) => x.id === d)) errors.push(`${at}: dependsOn ${d} is not a module`)
    if (strict && /TODO\(qa-pack\)/.test(read(path.join(cfg.dir, m.file)))) errors.push(`${at}: TODO(qa-pack) left (strict)`)
  }
  if (strict && reqs) {
    const inModules = new Set(mods.flatMap((m) => m.requirements ?? []))
    for (const r of reqs) if (!inModules.has(r.id) && r.verdict !== 'NOT-TESTABLE-LOCALLY') errors.push(`requirement ${r.id} belongs to no module (add it to the module.json of its journey ${r.journeys.join(', ') || '?'})`)
  }
  const cases = validateCases(cfg, { strict }), contracts = validateContracts(cfg, { strict })
  errors.push(...cases.errors, ...contracts.errors)
  // a case's requirement ids must be listed by its module
  for (const c of cases.cases) {
    const m = mods.find((x) => x.id === c.module); if (!m) { errors.push(`${c.file}: no module ${c.module} lists this case`); continue }
    for (const r of c.requirements) if (!(m.requirements ?? []).includes(r)) errors.push(`${c.file}: step names ${r}, which ${m.file} does not list`)
  }
  return { errors, warnings, modules: mods.length, cases: cases.cases.length, contracts: contracts.screens.length }
}

// ------------------------------------------------------------------ new-module
export function newModule(cfg, slugRaw, { name, area, screen } = {}) {
  if (!slugRaw || !area) throw Object.assign(new Error('usage: new-module <slug> --name "..." --area <AREA> [--screen <screen>]'), { code: 2 })
  const a = cfg.areas.find((x) => x.id === area); if (!a) throw Object.assign(new Error(`area ${area} is not in qa.config areas`), { code: 2 })
  const slug = slugify(slugRaw), mods = loadModules(cfg)
  const jp = path.join(cfg.abs('research'), 'journeys.json')
  const planned = fs.existsSync(jp) ? Object.values(readJson(jp).journeys) : []
  const pre = planned.find((j) => slugify(j.name) === slug && !mods.some((m) => m.id === j.id))
  const num = (id) => Number(/(\d+)$/.exec(id)?.[1] ?? 0)
  const id = pre?.id ?? `${cfg.ids.modulePrefix ?? 'J'}${String(Math.max(0, ...mods.map((m) => num(m.id)), ...planned.map((j) => num(j.id))) + 1).padStart(cfg.ids.modulePad ?? 2, '0')}`
  const scr = screen ?? `${a.slug}-${slug}`
  const casePath = `${cfg.paths.cases}/${a.slug}/${id}-${slug}.md`
  const firstReq = fs.existsSync(cfg.abs('requirements')) ? readJson(cfg.abs('requirements')).requirements.find((r) => r.journeys.includes(id))?.id : null
  const vars = { ID: id, NAME: name ?? slugRaw, AREA: area, SLUG: slug, CASE: casePath, SCREEN: scr, PREFIX: cfg.prefix, REQ: firstReq ?? `${area}-001` }
  const tpl = (f) => render(read(path.join(PACK_DIR, 'templates', 'module', f)), vars)
  const out = [[`${cfg.paths.modules}/${id}/module.json`, tpl('module.json')], [casePath, tpl('case.md')], [`${cfg.paths.modules}/${id}/non-browser.md`, tpl('non-browser.md')]]
  if (!fs.existsSync(path.join(cfg.abs('contracts'), `${scr}.json`))) out.push([`${cfg.paths.contracts}/${scr}.json`, tpl('contract.json')])
  if (cfg.mobile.enabled) out.push([`${cfg.mobile.maestro.flows}/${id}-${slug}.yaml`, tpl('maestro.yaml.stub')])
  const reqs = fs.existsSync(cfg.abs('requirements')) ? readJson(cfg.abs('requirements')).requirements.filter((r) => r.journeys.includes(id)).map((r) => r.id) : []
  if (reqs.length) { const mj = JSON.parse(out[0][1]); mj.requirements = reqs; out[0][1] = JSON.stringify(mj, null, 1) + '\n' }
  for (const [f, t] of out) { const p = path.join(cfg.dir, f); if (fs.existsSync(p)) throw Object.assign(new Error(`${f} exists already`), { code: 1 }); }
  for (const [f, t] of out) write(path.join(cfg.dir, f), t)
  return { id, files: out.map(([f]) => f) }
}

// ------------------------------------------------------------------ decisions (G1)
export function readDecisions(cfg) {
  const p = cfg.abs('decisions')
  if (!fs.existsSync(p)) return { file: cfg.paths.decisions, rows: [], exists: false }
  const rows = read(p).split(/\r?\n/).filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l) && !/^\|\s*Key\s*\|/i.test(l)).map((l) => {
    const c = l.replace(/^\||\|$/g, '').split('|').map((x) => x.trim())
    return { key: c[0], where: c[1], what: c[2], status: (c[3] ?? '').toLowerCase(), decision: c[4], date: c[5] }
  })
  return { file: cfg.paths.decisions, rows, exists: true }
}
export function seedDecisions(cfg) {
  const p = cfg.abs('decisions')
  if (!fs.existsSync(p)) write(p, read(path.join(PACK_DIR, 'templates', 'decisions.md')))
  const have = new Set(readDecisions(cfg).rows.map((r) => r.key)), add = []
  const reqs = fs.existsSync(cfg.abs('requirements')) ? readJson(cfg.abs('requirements')).requirements : []
  for (const r of reqs) if (['DIVERGENT', 'SPEC-CONFLICT'].includes(r.verdict) && !have.has(`D-${r.id}`)) add.push(`| D-${r.id} | ${r.id} | ${r.verdict}: ${r.requirement.replace(/\|/g, '/').slice(0, 160)} | open | | |`)
  for (const f of walk(cfg.abs('cases'), (x) => x.endsWith('.md'))) read(f).split(/\r?\n/).forEach((l, i) => {
    if (!/@owner-decision/.test(l)) return
    const key = `D-${path.basename(f, '.md').split('-')[0]}-${i + 1}`
    if (!have.has(key)) add.push(`| ${key} | ${cfg.rel(f)}:${i + 1} | ${l.replace(/\|/g, '/').trim().slice(0, 160)} | open | | |`)
  })
  if (add.length) fs.appendFileSync(p, add.join('\n') + '\n')
  return add.length
}

// ------------------------------------------------------------------ flow
const statePath = (cfg) => path.join(cfg.abs('state'), 'state.json')
export const loadState = (cfg) => (fs.existsSync(statePath(cfg)) ? readJson(statePath(cfg)) : { schema: 'qa-pack/state@1', steps: {} })

export async function planFlow(cfg, { only, from } = {}) {
  let steps = loadFlow(cfg)
  if (from) { const i = steps.findIndex((s) => s.id === from); if (i < 0) throw Object.assign(new Error(`--from ${from}: no such step`), { code: 2 }); steps = steps.slice(i) }
  if (only?.length) { for (const o of only) if (!steps.some((s) => s.id === o)) throw Object.assign(new Error(`--only ${o}: no such step`), { code: 2 }); steps = steps.filter((s) => only.includes(s.id)) }
  const caps = await probeCaps(cfg, [...new Set(steps.flatMap((s) => s.requires ?? []))])
  return steps.map((s) => {
    const missing = (s.requires ?? []).filter((r) => !caps[r]?.ok)
    return { ...s, plan: !s.applies ? 'n/a' : missing.length ? 'deferred' : 'run', missing }
  })
}

function runStep(cfg, s) {
  const [cmd, ...rest] = s.argv
  const r = spawnSync(cmd, rest, { cwd: cfg.dir, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, QA_PROJECT: cfg.dir } })
  return r.status === null ? 1 : r.status
}

export async function flow(cfg, o = {}) {
  const plan = await planFlow(cfg, o)
  const state = loadState(cfg)
  if (o.dry) return { plan, results: plan.map((s) => ({ id: s.id, status: s.plan === 'run' ? 'would-run' : s.plan, missing: s.missing })), dry: true }
  const results = []
  for (const s of plan) {
    const prev = state.steps[s.id]
    if (o.resume && prev?.status === 'done') { results.push({ id: s.id, status: 'done', resumed: true }); continue }
    let status, exit = null
    if (s.plan === 'n/a') status = 'n/a'
    else if (s.plan === 'deferred') status = 'deferred'
    else {
      console.log(`\n=== ${s.id} ${s.name}\n$ ${s.argv.join(' ')}`)
      exit = runStep(cfg, s)
      status = exit === 0 ? 'done' : exit === 3 ? 'deferred' : s.knownBaseline ? 'known-baseline' : s.gateOpen ? 'gate-open' : 'failed'
    }
    state.steps[s.id] = { status, exit, missing: s.missing, optional: !!s.optional, at: new Date().toISOString() }
    results.push({ id: s.id, status, missing: s.missing, optional: !!s.optional })
    writeJson(statePath(cfg), state)
  }
  writeReports(cfg, plan, results)
  return { plan, results }
}

function writeReports(cfg, plan, results) {
  const dir = cfg.abs('state'), byId = Object.fromEntries(plan.map((s) => [s.id, s]))
  const rows = results.map((r) => `| ${r.id} | ${byId[r.id].phase ?? ''} | ${byId[r.id].name ?? ''} | ${r.status}${r.resumed ? ' (resumed)' : ''} |`)
  write(path.join(dir, 'FLOW_REPORT.md'), [`# Flow report (${cfg.project})`, '', '| Step | Phase | Name | Status |', '|---|---|---|---|', ...rows, ''].join('\n'))
  const def = results.filter((r) => r.status === 'deferred')
  write(path.join(dir, 'DEFERRED.md'), [`# Deferred steps (${cfg.project})`, '', 'A deferred step did NOT pass: it could not run on this machine. Run it where the capability exists (or on the cloud fleet).', '',
    ...(def.length ? def.map((r) => `- ${r.id}${r.optional ? ' (optional)' : ''}: missing ${r.missing?.map((m) => `${m} (${CAPS[m]?.why ?? '?'})`).join(', ') || 'exit 3 from the step'}`) : ['None.']), ''].join('\n'))
}

export const flowExit = (results) => (results.some((r) => r.status === 'failed') ? 1 : results.some((r) => r.status === 'deferred' && !r.optional) ? 3 : 0)

// ------------------------------------------------------------------ gates
export function signed(text) { return /^Signed:\s*\S.*\d{4}-\d{2}-\d{2}/m.test(text) && !/\bTODO\b|\bUNSIGNED\b/.test(text) }

export function gates(cfg, only) {
  const def = readJson(path.join(PACK_DIR, 'gates', 'gates.json')).gates.filter((g) => cfg.gates.profiles.includes(g.profile))
  const flowSteps = loadFlow(cfg), state = loadState(cfg).steps
  return def.filter((g) => !only || g.id === only).map((g) => {
    const steps = (g.flowSteps ?? []).flatMap((x) => (x.startsWith('@') ? flowSteps.filter((s) => s.tags.includes(x.slice(1))).map((s) => s.id) : [x]))
    const missing = []
    for (const id of steps) {
      const s = flowSteps.find((x) => x.id === id)
      if (!s) continue // step removed by flow.skip
      if (!s.applies) continue
      const st = state[id]?.status
      if (st !== 'done' && !(s.optional && st === 'deferred')) missing.push(`step ${id}: ${st ?? 'not run'}`)
    }
    for (const e of g.evidence ?? []) {
      const p = path.join(cfg.abs('gateEvidence'), e)
      if (!fs.existsSync(p)) missing.push(`evidence ${cfg.paths.gateEvidence}/${e}: missing (template: qa-pack/evidence/${e})`)
      else if (!signed(read(p))) missing.push(`evidence ${cfg.paths.gateEvidence}/${e}: not signed (needs "Signed: <who> <yyyy-mm-dd>", no TODO/UNSIGNED)`)
    }
    if (g.id === 'G1') { const open = readDecisions(cfg).rows.filter((r) => r.status !== 'decided'); if (open.length) missing.push(`${open.length} open decision(s) in ${cfg.paths.decisions}`) }
    return { id: g.id, name: g.name, profile: g.profile, green: missing.length === 0, missing }
  })
}

// ------------------------------------------------------------------ status
export function status(cfg) {
  const mods = loadModules(cfg), by = {}
  for (const m of mods) (by[m.status] ??= []).push(m.id)
  const rp = cfg.abs('requirements'), req = fs.existsSync(rp) ? readJson(rp).totals : null
  const cp = cfg.abs('coverage'), cov = fs.existsSync(cp) ? readJson(cp).totals : null
  return { project: cfg.project, modules: by, requirements: req, coverage: cov, flow: loadState(cfg).steps }
}

// ------------------------------------------------------------------ CLI
async function main() {
  const a = args(), cmd = a.cmd
  const cfg = loadConfig(projectDirFrom())
  const sub = (script) => { const r = spawnSync(process.execPath, [path.join(PACK_DIR, 'scripts', script), ...a.argv.slice(1)], { cwd: cfg.dir, stdio: 'inherit', env: { ...process.env, QA_PROJECT: cfg.dir } }); return r.status ?? 1 }
  switch (cmd) {
    case 'status': { console.log(JSON.stringify(status(cfg), null, 1)); return 0 }
    case 'validate': {
      const r = validateProject(cfg, { strict: a.flag('--strict') })
      r.warnings.forEach((w) => console.log(`warning: ${w}`)); r.errors.forEach((e) => console.log(`error: ${e}`))
      console.log(`${cfg.project}: ${r.modules} module(s), ${r.cases} case(s), ${r.contracts} contract(s): ${r.errors.length ? `${r.errors.length} error(s)` : 'valid'}${a.flag('--strict') ? ' (strict)' : ''}`)
      return r.errors.length ? 1 : 0
    }
    case 'new-module': {
      const r = newModule(cfg, a.argv[1] && !a.argv[1].startsWith('--') ? a.argv[1] : null, { name: a.opt('--name'), area: a.opt('--area'), screen: a.opt('--screen') })
      console.log(`module ${r.id}:\n${r.files.map((f) => `  ${f}`).join('\n')}\nNext: /qa-author ${r.id}`); return 0
    }
    case 'capabilities': {
      const caps = await probeCaps(cfg)
      if (a.flag('--json')) console.log(JSON.stringify(caps, null, 1))
      else for (const [k, v] of Object.entries(caps)) console.log(`${v.ok ? 'yes' : 'no '}  ${k.padEnd(19)} ${v.why}`)
      return 0
    }
    case 'run': case 'flow': {
      if (a.opt('--target') === 'cloud') { const { cloudFlow } = await import('./cloud.mjs'); return cloudFlow(cfg, a) }
      const only = cmd === 'run' ? [a.argv[1]] : a.opt('--only')?.split(',')
      if (cmd === 'run' && !a.argv[1]) { console.log('usage: run <step-id>'); return 2 }
      const r = await flow(cfg, { dry: a.flag('--dry'), resume: a.flag('--resume'), only, from: a.opt('--from') })
      console.log(`\n${r.dry ? 'Flow plan (dry run, nothing executed)' : 'Flow result'} for ${cfg.project}:`)
      for (const x of r.results) console.log(`  ${x.status.padEnd(14)} ${x.id}${x.missing?.length ? `  (missing: ${x.missing.join(', ')})` : ''}`)
      if (r.dry) { const bad = r.plan.filter((s) => s.argv.some((x) => /\{\{[A-Z_]+\}\}/.test(x))); bad.forEach((s) => console.log(`error: ${s.id}: unrendered placeholder in ${s.argv.join(' ')}`)); return bad.length ? 1 : 0 }
      const code = flowExit(r.results)
      console.log(`\nReports: ${cfg.paths.state}/FLOW_REPORT.md, ${cfg.paths.state}/DEFERRED.md. Exit ${code} (${['green', 'red', '', 'deferred'][code]})`)
      return code
    }
    case 'decisions': {
      if (a.flag('--seed')) console.log(`seeded ${seedDecisions(cfg)} row(s)`)
      const d = readDecisions(cfg), open = d.rows.filter((r) => r.status !== 'decided')
      if (!d.exists) console.log(`no ${d.file}: 0 decisions (copy qa-pack/templates/decisions.md when the first one appears)`)
      for (const r of open) console.log(`open: ${r.key} ${r.where}: ${r.what}`)
      console.log(`${d.rows.length} decision(s), ${open.length} open`)
      return a.flag('--check') && open.length ? 1 : 0
    }
    case 'gate': {
      const only = a.argv[1] && /^G\d+$/.test(a.argv[1]) ? a.argv[1] : null
      const g = gates(cfg, only)
      if (a.flag('--json')) console.log(JSON.stringify(g, null, 1))
      else for (const x of g) { console.log(`${x.green ? 'GREEN' : 'OPEN '} ${x.id} ${x.name}`); x.missing.forEach((m) => console.log(`        - ${m}`)) }
      return g.every((x) => x.green) ? 0 : 1
    }
    case 'fleet-units': return sub('fleet-units.mjs')
    case 'plans': return sub('plans.mjs')
    default:
      console.log(read(new URL(import.meta.url)).split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
      return cmd ? 2 : 0
  }
}

if (isMain(import.meta.url)) {
  main().then((c) => process.exit(c ?? 0), (e) => { console.error(e.message); process.exit(typeof e.code === 'number' ? e.code : e.code === 'NO_CONFIG' || e.code === 'BAD_CONFIG' ? 2 : 1) })
}
