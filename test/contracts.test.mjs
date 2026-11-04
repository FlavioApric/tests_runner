// Contracts: config schema (example + starter template), S7 fleet units against the vendored qa-fleet schema,
// the cloud result folding, and `node --check` on every script.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, PACK, EXAMPLE, readJson, repoFiles } from './helpers.mjs'
import { loadConfig, validateConfig } from '../qa-pack/lib/config.mjs'
import { validate } from '../qa-pack/lib/jsonschema.mjs'
import { buildUnits, validateUnitsDoc, UNITS_SCHEMA } from '../qa-pack/scripts/fleet-units.mjs'
import { foldResults, fleetDir } from '../qa-pack/runners/cloud.mjs'

describe('qa.config.json', () => {
  test('the example config is valid', () => assert.deepEqual(validateConfig(readJson(path.join(EXAMPLE, 'qa.config.json'))), []))
  test('the starter template is valid', () => assert.deepEqual(validateConfig(readJson(path.join(PACK, 'templates', 'qa.config.json'))), []))
  test('duplicate persona keys and a bad id regex are reported', () => {
    const cfg = readJson(path.join(EXAMPLE, 'qa.config.json'))
    const errs = validateConfig({ ...cfg, personas: [...cfg.personas, cfg.personas[1]], ids: { ...cfg.ids, module: '(' } })
    assert.ok(errs.some((e) => /duplicate key/.test(e)), errs.join('; ')); assert.ok(errs.some((e) => /ids\.module/.test(e)), errs.join('; '))
  })
})

describe('S7 fleet units', () => {
  const { doc } = buildUnits(loadConfig(EXAMPLE))

  test('the generated units match the vendored qa-fleet units schema', async () => {
    const { errors } = await validateUnitsDoc(doc)
    assert.deepEqual(errors, [])
    assert.equal(doc.schema, 'qa-fleet/units@1')
    assert.ok(doc.units.some((u) => /-1-of-\d+$/.test(u.id)), 'the browser step is sharded')
    assert.ok(doc.units.some((u) => u.agent?.charter), 'explorer units carry a charter')
  })

  test('the committed .qa-fleet/units.json is the generated one', () => {
    assert.deepEqual(readJson(path.join(EXAMPLE, '.qa-fleet', 'units.json')), doc)
  })

  test('the schema rejects a unit without id and an agent without charter', () => {
    const schema = readJson(UNITS_SCHEMA)
    assert.ok(validate(schema, { ...doc, units: [{ step: 'x', cmd: 'true' }] }).length > 0, 'unit without id')
    assert.ok(validate(schema, { ...doc, units: [{ id: 'x', agent: { mcp: ['playwright'] } }] }).length > 0, 'agent without charter')
    assert.ok(validate(schema, { ...doc, units: [] }).length > 0, 'no units')
  })

  const fleetLib = path.join(process.env.QA_FLEET_DIR || fleetDir(), 'lib', 'units.mjs')
  test('the fleet own validateUnits() accepts the units (when a tests_runner main checkout is present)', { skip: !fs.existsSync(fleetLib) && 'no fleet checkout (set QA_FLEET_DIR)' }, async () => {
    const prev = process.env.QA_FLEET_DIR
    process.env.QA_FLEET_DIR = path.dirname(path.dirname(fleetLib))
    try { assert.deepEqual((await validateUnitsDoc(doc)).errors, []) } finally { if (prev === undefined) delete process.env.QA_FLEET_DIR; else process.env.QA_FLEET_DIR = prev }
  })
})

describe('cloud foldResults', () => {
  const units = [
    { id: 'b-1', step: 'browser' }, { id: 'b-2', step: 'browser' },
    { id: 'u', step: 'unit' }, { id: 'i', step: 'infra' }, { id: 'e', step: 'explore', agent: { charter: 'c.md' } },
  ]
  const steps = ['browser', 'unit', 'infra', 'explore', 'never-ran'].map((id) => ({ id }))
  const out = foldResults(units, {
    'b-1': { status: 'pass' }, 'b-2': { status: 'fail', junit: { tests: 4, failures: 1, errors: 0 } },
    u: { status: 'pass' }, i: { status: 'infra', reason: 'runner lost' }, e: { status: 'pass' },
  }, steps)

  test('any failed unit fails its step, with the junit count in the tail', () => {
    assert.equal(out.browser.status, 'failed'); assert.equal(out.browser.exit, 1)
    assert.deepEqual(out.browser.units, ['b-1', 'b-2']); assert.match(out.browser.tail, /b-2: fail \(1\/4 failed\)/)
  })
  test('all passing units make the step done', () => assert.deepEqual([out.unit.status, out.unit.exit], ['done', 0]))
  test('an infra failure defers the step instead of passing it', () => {
    assert.deepEqual([out.infra.status, out.infra.exit], ['deferred', 3]); assert.match(out.infra.missing[0], /^cloud-infra: i: runner lost/)
  })
  test('agent units and steps without results are left out', () => { assert.equal(out.explore, undefined); assert.equal(out['never-ran'], undefined) })
})

describe('scripts', () => {
  const scripts = repoFiles(REPO).filter((f) => /\.m?js$/.test(f))
  test('there are scripts to check', () => assert.ok(scripts.length > 20, String(scripts.length)))
  for (const f of scripts) {
    test(`node --check ${path.relative(REPO, f).split(path.sep).join('/')}`, () => {
      const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr)
    })
  }
})
