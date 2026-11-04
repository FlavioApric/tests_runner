#!/usr/bin/env node
// S2 consolidation: the researchers' area files -> requirements.json + TEST_REQUIREMENTS.md.
//   node qa-pack/scripts/consolidate.mjs [--project <dir>] [--check]
// Input: <research>/<AREA>-<slug>.md for every area of qa.config.json, each with the requirements table of BRIEF.md.
// - rows are de-duplicated by id (same id with a different requirement text is an error, not a silent pick)
// - `NEW:<name>` journeys get global module ids after the highest existing one; the assignment is kept in
//   <research>/journeys.json so a re-run never renumbers (idempotent)
// - deterministic output (no timestamps): --check fails only when the inputs changed
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, projectDirFrom } from '../lib/config.mjs'
import { args, read, readJson, write, walk, slugify, isMain } from '../lib/util.mjs'

export const VERDICTS = ['IMPLEMENTED', 'DIVERGENT', 'MISSING', 'SPEC-CONFLICT', 'NOT-TESTABLE-LOCALLY']
export const PRIORITIES = ['P0', 'P1', 'P2']
export const LAYERS = ['browser', 'api', 'unit', 'sql', 'edge', 'mobile', 'manual']
const COLS = { id: /^id$/, requirement: /^requirement/, source: /^source/, code: /^code/, verdict: /^verdict/, coverage: /coverage/, layer: /^layer/, scenarios: /^scenario/, journey: /^journey/, priority: /^priority/ }
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))

export function parseAreaFile(text, cfg, area, file) {
  const rows = [], errors = []
  let map = null
  text.split(/\r?\n/).forEach((line, i) => {
    if (!/^\s*\|/.test(line)) { map = /^\s*$/.test(line) ? map : null; return }
    const c = cells(line)
    if (c.every((x) => /^:?-{2,}:?$/.test(x))) return
    if (!map && c.some((x) => /^id$/i.test(x))) {
      map = {}
      c.forEach((h, k) => { for (const [key, re] of Object.entries(COLS)) if (re.test(h.toLowerCase()) && map[key] === undefined) map[key] = k })
      const missing = Object.keys(COLS).filter((k) => map[k] === undefined)
      if (missing.length) { errors.push(`${file}:${i + 1}: requirements table lacks column(s) ${missing.join(', ')}`); map = null }
      return
    }
    if (!map) return
    const get = (k) => c[map[k]] ?? ''
    const id = get('id').replace(/[`*]/g, '')
    if (!cfg.isReq(id)) return
    const at = `${file}:${i + 1} ${id}`
    const verdict = get('verdict').toUpperCase().match(/^[A-Z-]+/)?.[0] ?? ''
    const priority = get('priority').toUpperCase().match(/P\d/)?.[0] ?? ''
    const layers = get('layer').toLowerCase().split(/[,/+ ]+/).filter(Boolean)
    const journeyRaw = get('journey').replace(/`/g, '')
    if (!get('requirement')) errors.push(`${at}: empty requirement`)
    if (!VERDICTS.includes(verdict)) errors.push(`${at}: verdict "${get('verdict')}" not in ${VERDICTS.join('|')}`)
    if (!PRIORITIES.includes(priority)) errors.push(`${at}: priority "${get('priority')}" not in ${PRIORITIES.join('|')}`)
    for (const l of layers) if (!LAYERS.includes(l)) errors.push(`${at}: layer "${l}" not in ${LAYERS.join('|')}`)
    if (!id.startsWith(`${area.id}-`)) errors.push(`${at}: id does not start with the area id ${area.id}-`)
    const journeys = journeyRaw.split(/[,;]\s*/).map((j) => j.trim()).filter(Boolean)
    for (const j of journeys) if (!cfg.isMod(j) && !/^NEW:\s*\S/i.test(j)) errors.push(`${at}: journey "${j}" is neither a module id (${cfg.ids.module}) nor NEW:<name>`)
    rows.push({ id, area: area.id, requirement: get('requirement'), source: get('source'), code: get('code'), verdict, coverage: get('coverage'), layers, scenarios: get('scenarios').split(/,\s*/).filter(Boolean), journeys, priority, from: `${file}:${i + 1}` })
  })
  return { rows, errors }
}

const pad = (cfg, n) => `${cfg.ids.modulePrefix ?? 'J'}${String(n).padStart(cfg.ids.modulePad ?? 2, '0')}`

export function consolidate(cfg) {
  const researchDir = cfg.abs('research'), errors = [], files = []
  const all = []
  for (const area of cfg.areas) {
    const found = walk(researchDir, (p) => path.dirname(p) === researchDir && new RegExp(`^${area.id}-.+\\.md$`).test(path.basename(p)))
    if (!found.length) { errors.push(`area ${area.id}: no ${cfg.paths.research}/${area.id}-<slug>.md yet (run the researcher of this area)`); continue }
    for (const f of found) { const r = parseAreaFile(read(f), cfg, area, cfg.rel(f)); files.push({ area: area.id, file: cfg.rel(f), count: r.rows.length }); all.push(...r.rows); errors.push(...r.errors) }
  }
  // de-duplicate by id
  const byId = new Map()
  for (const r of all) {
    const prev = byId.get(r.id)
    if (!prev) { byId.set(r.id, r); continue }
    if (prev.requirement !== r.requirement) errors.push(`${r.id}: two different requirements (${prev.from} vs ${r.from})`)
    else prev.journeys = [...new Set([...prev.journeys, ...r.journeys])]
  }
  // NEW journeys -> stable global ids
  const jp = path.join(researchDir, 'journeys.json')
  const assigned = fs.existsSync(jp) ? readJson(jp).journeys : {}
  const modulesDir = cfg.abs('modules')
  const existing = walk(modulesDir, (p) => path.basename(p) === 'module.json').map((p) => readJson(p))
  const numOf = (id) => Number(/(\d+)$/.exec(id)?.[1] ?? 0)
  let next = Math.max(0, ...existing.map((m) => numOf(m.id)), ...Object.values(assigned).map((x) => numOf(x.id)), ...[...byId.values()].flatMap((r) => r.journeys.filter((j) => cfg.isMod(j)).map(numOf))) + 1
  const reqs = [...byId.values()].sort((a, b) => a.area.localeCompare(b.area) || a.id.localeCompare(b.id, 'en', { numeric: true }))
  for (const r of reqs) r.journeys = r.journeys.map((j) => {
    const m = /^NEW:\s*(.+)$/i.exec(j); if (!m) return j
    const key = slugify(m[1])
    assigned[key] ??= { id: pad(cfg, next++), name: m[1].trim() }
    return assigned[key].id
  })
  const journeys = {}
  for (const [key, v] of Object.entries(assigned)) journeys[v.id] = { name: v.name, key, requirements: [] }
  for (const m of existing) journeys[m.id] ??= { name: m.name, key: slugify(m.name), requirements: [] }
  for (const r of reqs) for (const j of r.journeys) (journeys[j] ??= { name: j, key: j.toLowerCase(), requirements: [] }).requirements.push(r.id)
  const sortedJourneys = Object.fromEntries(Object.entries(journeys).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })))
  for (const r of reqs) delete r.from
  const doc = { schema: 'qa-pack/requirements@1', project: cfg.project, sources: files, totals: totals(reqs), journeys: sortedJourneys, requirements: reqs }
  return { doc, journeysFile: { schema: 'qa-pack/journeys@1', journeys: Object.fromEntries(Object.entries(assigned).sort(([, a], [, b]) => a.id.localeCompare(b.id, 'en', { numeric: true }))) }, errors }
}

function totals(reqs) {
  const count = (f) => { const o = {}; for (const r of reqs) for (const v of [f(r)].flat()) o[v] = (o[v] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort()) }
  return { requirements: reqs.length, byVerdict: count((r) => r.verdict), byPriority: count((r) => r.priority), byLayer: count((r) => r.layers), byArea: count((r) => r.area) }
}

export function testRequirementsMarkdown(cfg, doc) {
  const t = doc.totals, esc = (s) => String(s).replace(/\|/g, '\\|')
  const kv = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ')
  const out = [`# Test requirements (${cfg.project})`, '', `Generated by \`node qa-pack/scripts/consolidate.mjs\` from ${doc.sources.map((s) => `\`${s.file}\``).join(', ')}. Do not edit by hand: edit the area files and re-run.`, '',
    `**${t.requirements} requirements.** Verdict: ${kv(t.byVerdict)}. Priority: ${kv(t.byPriority)}. Layer: ${kv(t.byLayer)}.`, '']
  out.push('## Journeys', '', '| Journey | Name | Requirements |', '|---|---|---|', ...Object.entries(doc.journeys).map(([id, j]) => `| ${id} | ${esc(j.name)} | ${j.requirements.join(', ') || '(none)'} |`), '')
  for (const a of cfg.areas) {
    const rows = doc.requirements.filter((r) => r.area === a.id); if (!rows.length) continue
    out.push(`## ${a.id} ${a.title}`, '', '| ID | Requirement | Verdict | Layer | Journey | Priority | Source | Code |', '|---|---|---|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.id} | ${esc(r.requirement)} | ${r.verdict} | ${r.layers.join(', ')} | ${r.journeys.join(', ')} | ${r.priority} | ${esc(r.source)} | ${esc(r.code)} |`), '')
  }
  const div = doc.requirements.filter((r) => r.verdict !== 'IMPLEMENTED')
  out.push('## Divergences, missing and conflicts', '', div.length ? div.map((r) => `- ${r.id} ${r.verdict}: ${r.requirement}`).join('\n') : 'None.', '')
  return out.join('\n')
}

if (isMain(import.meta.url)) {
  const a = args(), cfg = loadConfig(projectDirFrom())
  const { doc, journeysFile, errors } = consolidate(cfg)
  const jsonText = JSON.stringify(doc, null, 1) + '\n', mdText = testRequirementsMarkdown(cfg, doc), jText = JSON.stringify(journeysFile, null, 1) + '\n'
  errors.forEach((e) => console.log(`error: ${e}`))
  const targets = [[cfg.abs('requirements'), jsonText], [cfg.abs('testRequirements'), mdText], [path.join(cfg.abs('research'), 'journeys.json'), jText]]
  if (a.flag('--check')) {
    const stale = targets.filter(([p, t]) => !fs.existsSync(p) || read(p).replace(/\r/g, '') !== t).map(([p]) => cfg.rel(p))
    console.log(stale.length ? `stale: ${stale.join(', ')} (run consolidate.mjs)` : `requirements up to date: ${doc.totals.requirements}`)
    process.exit(stale.length || errors.length ? 1 : 0)
  }
  if (errors.length) { console.log(`${errors.length} problem(s): nothing written`); process.exit(1) }
  for (const [p, t] of targets) write(p, t)
  console.log(`consolidated ${doc.totals.requirements} requirements, ${Object.keys(doc.journeys).length} journeys -> ${cfg.paths.requirements}, ${cfg.paths.testRequirements}`)
}
