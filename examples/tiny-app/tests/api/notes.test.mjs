// Backend layer of the example (adapter node-test): domain rules R1-001..R1-005 at unit level.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createStore, validateTitle, countLabel } from '../../api/notes.mjs'

const SPEC_MESSAGE = 'Title must be 1-80 characters' // docs/SPEC.md 1.2: the oracle is the spec text, not the code constant

test('R1-001 a 1..80 character title is saved, trimmed, newest first', () => {
  const s = createStore()
  s.add('a', 'first', 1000); const r = s.add('a', '  second  ', 2000)
  assert.equal(r.note.title, 'second')
  assert.deepEqual(s.list('a').map((n) => n.title), ['second', 'first'])
  assert.equal(validateTitle('x'.repeat(80)).ok, true)
})

test('R1-002 empty and 81-character titles are refused with the spec message, nothing saved', () => {
  const s = createStore()
  for (const t of ['', '   ', 'x'.repeat(81)]) assert.deepEqual(s.add('a', t), { ok: false, error: SPEC_MESSAGE })
  assert.equal(s.list('a').length, 0)
})

test('R1-003 count label: 1 note, N notes', () => {
  assert.deepEqual([0, 1, 2].map(countLabel), ['0 notes', '1 note', '2 notes'])
})

test('R1-004 R2-003 owner deletes own note; another user cannot and sees "missing"', () => {
  const s = createStore()
  const { note } = s.add('a', 'mine')
  assert.equal(s.remove('b', note.id), false)
  assert.equal(s.list('a').length, 1)
  assert.equal(s.remove('a', note.id), true)
  assert.equal(s.remove('a', note.id), false)
})

test('R1-005 lists never leak another owner', () => {
  const s = createStore()
  s.add('a', 'a1'); s.add('b', 'b1')
  assert.deepEqual(s.list('b').map((n) => n.owner), ['b'])
})
