import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateKeys, sealFile, openFile, sealBuffer, openBuffer } from '../lib/crypto.mjs'
import { plan } from '../lib/planner.mjs'
import { validateUnits, expandUnits, selectUnits, matrixEntry, SCHEMA, localAgents } from '../lib/units.mjs'
import { summarizeXml } from '../lib/junit.mjs'
import { unzipToDir } from '../lib/zip.mjs'
import { initProject } from '../lib/init.mjs'
import { makeZip } from './helpers.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qaf-test-'))

test('seal/open round trip, wrong key and tampering are rejected', async () => {
  const d = tmp(), k = generateKeys(), other = generateKeys()
  const data = Buffer.concat([Buffer.from('secret results '), Buffer.alloc(300000, 7)])
  fs.writeFileSync(path.join(d, 'in'), data)
  await sealFile(path.join(d, 'in'), path.join(d, 'sealed'), k.recipient)
  const sealed = fs.readFileSync(path.join(d, 'sealed'))
  assert.equal(sealed.subarray(0, 4).toString(), 'QAF1')
  assert.ok(!sealed.includes(Buffer.from('secret results')))
  await openFile(path.join(d, 'sealed'), path.join(d, 'out'), k.identity)
  assert.deepEqual(fs.readFileSync(path.join(d, 'out')), data)
  await assert.rejects(openFile(path.join(d, 'sealed'), path.join(d, 'out2'), other.identity))
  sealed[100] ^= 1
  fs.writeFileSync(path.join(d, 'bad'), sealed)
  await assert.rejects(openFile(path.join(d, 'bad'), path.join(d, 'out3'), k.identity))
  assert.ok(!fs.existsSync(path.join(d, 'out3')), 'no plaintext is left when the tag fails')
})

test('planner balances by minutes and respects slots', () => {
  const units = Array.from({ length: 50 }, (_, i) => ({ id: `u${i}`, estMinutes: (i % 5) + 1 }))
  const runners = [1, 2, 3, 4, 5].map((i) => ({ name: `r${i}`, maxParallel: 3 }))
  const p = plan(units, runners)
  assert.equal(p.assignments.reduce((a, x) => a + x.units.length, 0), 50)
  assert.ok(p.assignments.every((a) => a.slots === 3))
  const total = units.reduce((a, u) => a + u.estMinutes, 0)
  assert.ok(p.estWallMinutes <= Math.ceil(total / 15) + 5, `wall ${p.estWallMinutes}`)
  const r = plan([{ id: 'x', estMinutes: 5, avoidRunners: ['r1'] }], runners)
  assert.notEqual(r.assignments[0].runner, 'r1')
  const busy = plan(units, [{ name: 'a', maxParallel: 20, freeSlots: 1 }, { name: 'b', maxParallel: 20 }])
  assert.ok(busy.assignments.find((a) => a.runner === 'b').units.length > busy.assignments.find((a) => a.runner === 'a').units.length)
})

test('units contract: validation, defaults, selection, matrix', () => {
  const doc = { schema: SCHEMA, defaults: { needs: ['node:22'], secrets: ['A_KEY'] }, units: [
    { id: 'web-1', cmd: 'npm test', step: 'f4', tags: ['web'], needs: ['browsers:chromium,webkit'] },
    { id: 'mob', cmd: 'maestro test', needs: ['android-emulator:35'] },
    { id: 'ex', agent: { charter: 'c.md', mcp: ['mobile'] } },
  ] }
  assert.deepEqual(validateUnits(doc), [])
  const u = expandUnits(doc)
  assert.deepEqual(u[0].needs, ['node:22', 'browsers:chromium,webkit'])
  assert.ok(!u[2].secrets.some((s) => /CLAUDE/.test(s)) && u[2].tags.includes('agent') && u[2].local, 'agent units are local only, no Claude token')
  assert.deepEqual(selectUnits(u).map((x) => x.id), ['web-1', 'mob'], 'agent units never go to a runner')
  assert.deepEqual(localAgents(u).map((x) => x.id), ['ex'])
  assert.throws(() => matrixEntry(u[2]), /local Claude explorer/)
  assert.ok(validateUnits({ schema: SCHEMA, units: [{ id: 'z', cmd: 'x', secrets: ['CLAUDE_CODE_OAUTH_TOKEN'] }] }).some((e) => e.includes('Claude credentials')))
  assert.deepEqual(selectUnits(u, { only: ['f4'] }).map((x) => x.id), ['web-1'])
  const m = matrixEntry(u[1])
  assert.equal(m.emulatorApi, '35'); assert.equal(m.kvm, true); assert.equal(m.java, '21'); assert.equal(m.secrets, 'A_KEY')
  assert.equal(JSON.stringify(m).includes('maestro'), false, 'the matrix never carries the command')
  const bad = validateUnits({ schema: SCHEMA, units: [{ id: 'a', cmd: 'x', needs: ['gpu'], secrets: ['SOURCE_REPO_TOKEN'] }, { id: 'a', cmd: 'y' }, { id: '../x' }] })
  for (const s of ['unknown need', 'bad secret', 'duplicate', 'id must match', 'needs cmd']) assert.ok(bad.some((e) => e.includes(s)), s)
})

test('junit summary across formats', () => {
  const pytest = '<testsuites><testsuite name="p" tests="3"><testcase classname="t.a" name="ok"/><testcase classname="t.a" name="bad"><failure message="x"/></testcase><testcase name="sk"><skipped/></testcase></testsuite></testsuites>'
  assert.deepEqual(summarizeXml(pytest), { tests: 3, failures: 1, errors: 0, skipped: 1, failed: ['t.a > bad'] })
  assert.equal(summarizeXml('<testsuite name="g" tests="7" failures="2" errors="1" skipped="0"></testsuite>').tests, 7)
  assert.equal(summarizeXml('<html/>'), null)
})

test('zip reader: stored + deflate, refuses path traversal', () => {
  const d = tmp()
  const files = unzipToDir(makeZip([['a/b.txt', Buffer.from('hello')], ['c.bin', Buffer.alloc(5000, 1), true]]), d)
  assert.equal(files.length, 2)
  assert.equal(fs.readFileSync(path.join(d, 'a', 'b.txt'), 'utf8'), 'hello')
  assert.equal(fs.readFileSync(path.join(d, 'c.bin')).length, 5000)
  const d2 = path.join(tmp(), 'deep', 'er')
  fs.mkdirSync(d2, { recursive: true })
  try { unzipToDir(makeZip([['../../evil.txt', Buffer.from('x')]]), d2) } catch { /* refusing is fine too */ }
  assert.ok(!fs.existsSync(path.join(d2, '..', '..', 'evil.txt')), 'nothing written outside the target')
})

test('fleet init writes a valid contract for every kind', () => {
  for (const kind of ['playwright', 'vitest', 'jest', 'pytest', 'go', 'maestro', 'gradle', 'shell']) {
    const d = tmp()
    initProject(d, { kind, shards: 3 })
    const doc = JSON.parse(fs.readFileSync(path.join(d, '.qa-fleet', 'units.json'), 'utf8'))
    assert.deepEqual(validateUnits(doc), [], kind)
    assert.ok(fs.existsSync(path.join(d, '.qa-fleet', 'unit.sh')))
  }
})

test('example project contract is valid', () => {
  const doc = JSON.parse(fs.readFileSync(new URL('../examples/py-js/.qa-fleet/units.json', import.meta.url), 'utf8'))
  assert.deepEqual(validateUnits(doc), [])
})

test('sealBuffer/openBuffer: round trip, wrong key rejected', () => {
  const a = generateKeys(), b = generateKeys()
  const t = sealBuffer(Buffer.from('{"x":1}'), a.recipient)
  assert.equal(openBuffer(t, a.identity).toString(), '{"x":1}')
  assert.throws(() => openBuffer(t, b.identity), /wrong key/)
  assert.ok(!t.includes('"x"'))
})
