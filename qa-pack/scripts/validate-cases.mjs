#!/usr/bin/env node
// S3/S4 check of the browser-test cases (<paths.cases>/**/*.md), the format of qa-pack/conventions.md:
//   sections Summary, Preconditions (with Markers), Before Hook, Test Steps, After Hook;
//   every step `### n. <ReqId...> Title` with **Verify:** and **Oracle:**, known requirement ids,
//   `Design contract: <screen>#<key>` pointing at a real contract key.
//   --strict also fails on any TODO(qa-pack) left in a case.
//   node qa-pack/scripts/validate-cases.mjs [--project <dir>] [--strict]
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, projectDirFrom } from '../lib/config.mjs'
import { args, read, readJson, walk, isMain } from '../lib/util.mjs'

const SECTIONS = ['Summary', 'Preconditions', 'Before Hook', 'Test Steps', 'After Hook']

export function knownRequirements(cfg) {
  const p = cfg.abs('requirements')
  return fs.existsSync(p) ? new Set(readJson(p).requirements.map((r) => r.id)) : null
}

export function parseCase(text) {
  const lines = text.split(/\r?\n/), sections = [], steps = []
  let cur = null, section = null
  lines.forEach((l, i) => {
    const h2 = /^##\s+(.+?)\s*$/.exec(l)
    if (h2) { section = h2[1]; sections.push(section); cur = null; return }
    const h3 = /^###\s+(\d+)\.\s+(.*)$/.exec(l)
    if (h3 && section === 'Test Steps') { cur = { n: Number(h3[1]), title: h3[2], line: i + 1, body: [] }; steps.push(cur); return }
    if (/^###\s/.test(l)) { cur = null; return }
    if (cur) cur.body.push(l)
  })
  for (const s of steps) {
    const b = s.body.join('\n')
    s.verify = /\*\*Verify:\*\*\s*\S/.test(b)
    s.oracle = /\*\*Oracle:\*\*\s*\S/.test(b)
    s.contracts = [...b.matchAll(/^Design contract:\s*(.+)$/gm)].flatMap((m) => m[1].split(/[,\s]+/).filter(Boolean))
  }
  const markers = /\*\*Markers:\*\*\s*(.+)/.exec(text)?.[1].match(/@[\w-]+/g) ?? []
  return { sections, steps, markers }
}

export function validateCases(cfg, { strict = false } = {}) {
  const errors = [], reqs = knownRequirements(cfg), contractsDir = cfg.abs('contracts')
  const files = walk(cfg.abs('cases'), (p) => p.endsWith('.md') && !/README|conventions/i.test(path.basename(p)))
  const contractKeys = (screen) => { const p = path.join(contractsDir, `${screen}.json`); return fs.existsSync(p) ? Object.keys(readJson(p).keys ?? {}) : null }
  const cases = []
  for (const f of files) {
    const rel = cfg.rel(f), text = read(f), c = parseCase(text)
    const id = cfg.modRe('').exec(path.basename(f))?.[0]
    if (!id) errors.push(`${rel}: file name must start with a module id (${cfg.ids.module})`)
    for (const s of SECTIONS) if (!c.sections.some((x) => x.startsWith(s))) errors.push(`${rel}: missing section "## ${s}"`)
    if (!c.markers.length) errors.push(`${rel}: Preconditions need a **Markers:** line`)
    if (!c.steps.length) errors.push(`${rel}: no "### n. <ReqId> Title" steps under Test Steps`)
    const ids = new Set()
    c.steps.forEach((s, k) => {
      const at = `${rel}:${s.line} step ${s.n}`
      if (s.n !== k + 1) errors.push(`${at}: steps must be numbered 1..n in order`)
      const sr = s.title.match(cfg.reqRe()) ?? []
      if (!sr.length) errors.push(`${at}: title names no requirement id (${cfg.ids.requirement})`)
      for (const r of sr) { ids.add(r); if (reqs && !reqs.has(r)) errors.push(`${at}: unknown requirement ${r} (not in ${cfg.paths.requirements})`) }
      if (!s.verify) errors.push(`${at}: no **Verify:**`)
      if (!s.oracle) errors.push(`${at}: no **Oracle:** (conventions: Correctness oracles)`)
      for (const ref of s.contracts) {
        const [screen, key] = ref.split('#'); const keys = contractKeys(screen)
        if (!keys) errors.push(`${at}: design contract ${screen} has no ${cfg.paths.contracts}/${screen}.json`)
        else if (key && !keys.includes(key) && !(strict === false && key === 'TODO')) errors.push(`${at}: design contract key ${ref} does not exist`)
      }
    })
    if (strict && /TODO\(qa-pack\)/.test(text)) errors.push(`${rel}: TODO(qa-pack) left (strict)`)
    cases.push({ file: rel, module: id, requirements: [...ids].sort(), steps: c.steps.length })
  }
  return { cases, errors }
}

if (isMain(import.meta.url)) {
  const a = args(), cfg = loadConfig(projectDirFrom())
  const { cases, errors } = validateCases(cfg, { strict: a.flag('--strict') })
  errors.forEach((e) => console.log(`error: ${e}`))
  console.log(`${cases.length} case(s), ${cases.reduce((n, c) => n + c.steps, 0)} step(s), ${errors.length} error(s)`)
  process.exit(errors.length ? 1 : 0)
}
