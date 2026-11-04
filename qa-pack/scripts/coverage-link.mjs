#!/usr/bin/env node
// S5 coverage link: which test file names which requirement id in a test title (compiled browser specs,
// backend tests, any dir in --dirs). Writes <paths.coverage>. A requirement is "uncovered" when no test names it,
// unless its verdict is NOT-TESTABLE-LOCALLY or its only layer is manual (those go to the gate evidence instead).
//   node qa-pack/scripts/coverage-link.mjs [--project <dir>] [--check] [--dirs a,b]
import fs from 'node:fs'
import { loadConfig, projectDirFrom } from '../lib/config.mjs'
import { args, read, readJson, write, walk, isMain } from '../lib/util.mjs'

const TEST_FILE = /\.(spec|test|setup)\.m?[jt]sx?$|(^|[\\/])test_[^\\/]+\.py$|_test\.py$/
// titles of test()/it()/describe() calls and python test function docstrings/names
const TITLE = /\b(?:test|it|describe)(?:\.(?:describe|only|skip|fixme|serial|parallel|step))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g

export function testDirs(cfg, extra = []) {
  const d = [cfg.paths.compiled]
  if (cfg.backend.adapter !== 'none' && cfg.backend.tests) d.push(cfg.backend.tests)
  for (const s of cfg.flow?.extra ?? []) for (const x of s.coverage ?? []) d.push(x)
  return [...new Set([...d, ...extra])]
}

export function linkCoverage(cfg, extra = []) {
  const p = cfg.abs('requirements')
  if (!fs.existsSync(p)) return { doc: null, errors: [`no ${cfg.paths.requirements}: run consolidate.mjs first`] }
  const reqs = readJson(p).requirements, known = new Set(reqs.map((r) => r.id))
  const by = Object.fromEntries(reqs.map((r) => [r.id, []])), errors = []
  for (const dir of testDirs(cfg, extra)) for (const f of walk(cfg.abs(dir), (x) => TEST_FILE.test(x))) {
    const text = read(f), rel = cfg.rel(f)
    const titles = [...text.matchAll(TITLE)].map((m) => m[2])
    if (f.endsWith('.py')) titles.push(...[...text.matchAll(/def (test_\w+)/g)].map((m) => m[1].replace(/_/g, '-').toUpperCase()))
    for (const t of titles) for (const id of t.match(cfg.reqRe()) ?? []) {
      if (!known.has(id)) { errors.push(`${rel}: test title names unknown requirement ${id}`); continue }
      if (!by[id].includes(rel)) by[id].push(rel)
    }
  }
  for (const v of Object.values(by)) v.sort()
  const exempt = (r) => r.verdict === 'NOT-TESTABLE-LOCALLY' || (r.layers.length > 0 && r.layers.every((l) => l === 'manual'))
  const uncovered = reqs.filter((r) => !by[r.id].length && !exempt(r)).map((r) => r.id)
  const doc = { schema: 'qa-pack/coverage@1', dirs: testDirs(cfg, extra), totals: { requirements: reqs.length, covered: reqs.filter((r) => by[r.id].length).length, exempt: reqs.filter(exempt).length, uncovered: uncovered.length }, uncovered, requirements: by }
  return { doc, errors: [...new Set(errors)] }
}

if (isMain(import.meta.url)) {
  const a = args(), cfg = loadConfig(projectDirFrom())
  const { doc, errors } = linkCoverage(cfg, (a.opt('--dirs') ?? '').split(',').filter(Boolean))
  errors.forEach((e) => console.log(`error: ${e}`))
  if (!doc) process.exit(1)
  const text = JSON.stringify(doc, null, 1) + '\n', out = cfg.abs('coverage')
  for (const id of doc.uncovered) console.log(`uncovered: ${id}`)
  console.log(`coverage: ${doc.totals.covered}/${doc.totals.requirements} covered, ${doc.totals.exempt} exempt, ${doc.totals.uncovered} uncovered`)
  if (a.flag('--check')) {
    const stale = !fs.existsSync(out) || read(out).replace(/\r/g, '') !== text
    if (stale) console.log(`stale: ${cfg.paths.coverage} (run coverage-link.mjs)`)
    process.exit(stale || doc.uncovered.length || errors.length ? 1 : 0)
  }
  write(out, text)
  process.exit(doc.uncovered.length || errors.length ? 1 : 0)
}
