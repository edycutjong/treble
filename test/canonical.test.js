import test from 'brittle'
import { stableStringify, hashValue, stateHash } from '../src/core/canonical.js'

test('canonical: key order does not change output', t => {
  const a = stableStringify({ b: 1, a: 2, c: { z: 1, y: 2 } })
  const b = stableStringify({ c: { y: 2, z: 1 }, a: 2, b: 1 })
  t.is(a, b)
})

test('canonical: arrays keep their order', t => {
  t.is(stableStringify([3, 1, 2]), '[3,1,2]')
  t.not(stableStringify([1, 2, 3]), stableStringify([3, 2, 1]))
})

test('canonical: primitives pass through', t => {
  t.is(stableStringify('x'), '"x"')
  t.is(stableStringify(5), '5')
  t.is(stableStringify(true), 'true')
  t.is(stableStringify(null), 'null')
})

test('canonical: rejects non-deterministic values', t => {
  t.exception.all(() => stableStringify({ a: undefined }))
  t.exception.all(() => stableStringify({ a: NaN }))
  t.exception.all(() => stableStringify({ a: Infinity }))
  t.exception.all(() => stableStringify({ a: 1n }))
})

test('canonical: hashValue is stable and hex', t => {
  const h1 = hashValue({ x: 1, y: [1, 2] })
  const h2 = hashValue({ y: [1, 2], x: 1 })
  t.is(h1, h2)
  t.ok(/^[0-9a-f]{64}$/.test(h1))
})

test('canonical: different values hash differently', t => {
  t.not(hashValue({ a: 1 }), hashValue({ a: 2 }))
})

test('canonical: stateHash is an alias over hashValue semantics', t => {
  const state = { seq: 3, stakes: { b: 1, a: 2 } }
  t.is(stateHash(state), hashValue(state))
})
