import { test } from 'node:test'
import assert from 'node:assert/strict'
test('sum', () => assert.equal([1, 2, 3].reduce((a, b) => a + b, 0), 6))
test('json', () => assert.deepEqual(JSON.parse('{"a":1}'), { a: 1 }))
