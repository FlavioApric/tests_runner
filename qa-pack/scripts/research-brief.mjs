#!/usr/bin/env node
// S2 research: render one brief per area of qa.config.json from qa-pack/research/BRIEF.md.
//   node qa-pack/scripts/research-brief.mjs [--project <dir>] [--area R1] [--check]
// Then dispatch ONE researcher subagent per area, all in parallel (they only read, and each writes only its own
// output file): "Follow <briefs>/<AREA>.md exactly." When all are done: node qa-pack/scripts/consolidate.mjs
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, projectDirFrom } from '../lib/config.mjs'
import { PACK_DIR, args, read, write, render, isMain } from '../lib/util.mjs'

export const outputOf = (cfg, a) => `${cfg.paths.research}/${a.id}-${a.slug}.md`

export function briefs(cfg) {
  const tpl = read(path.join(PACK_DIR, 'research', 'BRIEF.md'))
  const list = (xs) => (xs?.length ? xs.map((x) => `\`${x}\``).join(', ') : '(none listed)')
  return cfg.areas.map((a) => ({
    area: a.id,
    file: `${cfg.paths.briefs}/${a.id}.md`,
    text: render(tpl, {
      PROJECT: cfg.project, AREA_ID: a.id, AREA_TITLE: a.title, AREA_COUNT: cfg.areas.length, AREA_FOCUS: a.focus ? ` Focus: ${a.focus}` : '',
      AREA_DOCS: list(a.docs), ALL_DOCS: list(cfg.app.docs), PRECEDENCE: cfg.app.precedence ?? 'the newest document wins; record every conflict as SPEC-CONFLICT',
      AREA_CODE: list(a.code), APP_SRC: list(cfg.app.src), INVENTORY: cfg.paths.inventory, GRAPH: cfg.paths.graph,
      TEST_DIRS: list([cfg.paths.tests ?? 'tests', cfg.paths.compiled]), PERSONAS_FILE: cfg.env?.personasFile ?? '.env.qa.personas.local',
      PERSONAS: cfg.personas.map((p) => `${p.key} (${p.role})`).join(', '), OUTPUT: outputOf(cfg, a),
      REQ_ID_REGEX: cfg.ids.requirement, MODULE_ID_REGEX: cfg.ids.module,
    }),
  }))
}

if (isMain(import.meta.url)) {
  const a = args(), cfg = loadConfig(projectDirFrom())
  const only = a.opt('--area')
  let stale = 0
  for (const b of briefs(cfg).filter((b) => !only || b.area === only)) {
    const p = path.join(cfg.dir, b.file)
    if (a.flag('--check')) { if (!fs.existsSync(p) || read(p).replace(/\r/g, '') !== b.text) { stale++; console.log(`stale ${b.file}`) } continue }
    write(p, b.text); console.log(`brief ${b.file}`)
  }
  if (a.flag('--check')) { console.log(stale ? `${stale} brief(s) stale` : 'briefs up to date'); process.exit(stale ? 1 : 0) }
  console.log(`\nNext: one researcher subagent per area, in parallel ("Follow ${cfg.paths.briefs}/<AREA>.md exactly"), then node qa-pack/scripts/consolidate.mjs`)
}
