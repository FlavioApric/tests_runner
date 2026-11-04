// S1-S7 on a copy of the example: every stage produces valid output, the checks are idempotent, and a broken input is caught.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { copyExample, rm, pack, readJson } from './helpers.mjs'
import { VERDICTS, PRIORITIES, LAYERS } from '../qa-pack/scripts/consolidate.mjs'

let dir
before(() => { dir = copyExample() })
after(() => rm(dir))

describe('S1 inventory', () => {
  test('writes a valid inventory of the JS and Python sources, then --check is clean', () => {
    fs.rmSync(path.join(dir, 'qa', 'inventory.json'))
    const r = pack('scripts/inventory.mjs', [], dir)
    assert.equal(r.status, 0, r.out)
    const inv = readJson(path.join(dir, 'qa', 'inventory.json'))
    assert.equal(inv.schema, 'qa-pack/inventory@1')
    assert.ok(inv.functions.length > 0)
    for (const f of inv.functions) {
      assert.equal(typeof f.name, 'string'); assert.ok(Number.isInteger(f.line) && f.line > 0, `${f.file}:${f.line}`)
      assert.ok(fs.existsSync(path.join(dir, f.file)), f.file); assert.ok(Array.isArray(f.callers) && Array.isArray(f.testedBy))
    }
    const langs = new Set(inv.functions.map((f) => f.language))
    assert.ok(langs.has('js') && langs.has('py'), [...langs].join(','))
    assert.equal(pack('scripts/inventory.mjs', ['--check'], dir).status, 0)
  })
})

describe('S2 consolidate', () => {
  test('writes requirements.json + TEST_REQUIREMENTS.md with valid rows, then --check is clean', () => {
    const r = pack('scripts/consolidate.mjs', [], dir)
    assert.equal(r.status, 0, r.out)
    const cfg = readJson(path.join(dir, 'qa.config.json'))
    const doc = readJson(path.join(dir, 'qa', 'research', 'requirements.json'))
    assert.equal(doc.schema, 'qa-pack/requirements@1')
    const idRe = new RegExp(`^${cfg.ids.requirement}$`), areas = new Set(cfg.areas.map((a) => a.id))
    assert.ok(doc.requirements.length > 0)
    for (const q of doc.requirements) {
      assert.match(q.id, idRe); assert.ok(areas.has(q.area), q.id)
      assert.ok(VERDICTS.includes(q.verdict), `${q.id} ${q.verdict}`); assert.ok(PRIORITIES.includes(q.priority), q.id)
      for (const l of q.layers) assert.ok(LAYERS.includes(l), `${q.id} ${l}`)
    }
    assert.equal(new Set(doc.requirements.map((q) => q.id)).size, doc.requirements.length, 'ids are unique')
    assert.ok(fs.readFileSync(path.join(dir, 'qa', 'research', 'TEST_REQUIREMENTS.md'), 'utf8').includes(doc.requirements[0].id))
    assert.equal(pack('scripts/consolidate.mjs', ['--check'], dir).status, 0)
  })

  test('a duplicate id with a different requirement text is an error, not a silent pick', () => {
    const d = copyExample()
    try {
      const f = path.join(d, 'qa', 'research', 'R1-notes.md'), text = fs.readFileSync(f, 'utf8')
      const row = text.split('\n').find((l) => /^\|\s*R1-001\s*\|/.test(l))
      assert.ok(row, 'fixture has an R1-001 row')
      fs.writeFileSync(f, text.replace(row, `${row}\n${row.replace(/^(\|\s*R1-001\s*\|)[^|]*/, '$1 a different text ')}`))
      assert.notEqual(pack('scripts/consolidate.mjs', [], d).status, 0)
    } finally { rm(d) }
  })
})

describe('S3-S5 validate', () => {
  test('pack validate --strict passes on the example', () => {
    const r = pack('runners/pack.mjs', ['validate', '--strict'], dir)
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /valid \(strict\)/)
  })

  test('a draft module fails --strict', () => {
    const d = copyExample()
    try {
      const f = path.join(d, 'qa', 'modules', 'J01', 'module.json'), m = readJson(f)
      fs.writeFileSync(f, JSON.stringify({ ...m, status: 'draft' }))
      const r = pack('runners/pack.mjs', ['validate', '--strict'], d)
      assert.equal(r.status, 1, r.out); assert.match(r.out, /still draft/)
    } finally { rm(d) }
  })

  test('access matrix, coverage and plans are current (--check)', () => {
    for (const s of ['access-matrix', 'coverage-link', 'plans']) {
      const r = pack(`scripts/${s}.mjs`, ['--check'], dir)
      assert.equal(r.status, 0, `${s}: ${r.out}`)
    }
  })
})

describe('flow', () => {
  test('flow --dry plans every step and executes nothing', () => {
    const r = pack('runners/pack.mjs', ['flow', '--dry'], dir)
    assert.equal(r.status, 0, r.out)
    for (const id of ['s1-inventory', 's2-requirements', 's3-validate', 's5-coverage', 's6-access', 's6-browser', 's7-fleet', 'f2-unit']) assert.match(r.out, new RegExp(`\\b${id}\\b`))
    assert.ok(!fs.existsSync(path.join(dir, '.qa-pack', 'state.json')), 'a dry run writes no state')
  })
})
