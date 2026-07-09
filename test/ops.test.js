import test from 'brittle'
import * as ops from '../src/core/ops.js'
import { structuralError } from '../src/core/ops.js'
import { KICKOFF, T, KEYS, BUY_IN, openOp } from './helpers.js'

test('ops: a well-formed open op passes structural validation', t => {
  t.is(structuralError(openOp()), null)
})

test('ops: non-objects and unknown types are malformed', t => {
  t.is(structuralError(null), 'not-an-object')
  t.is(structuralError([1]), 'not-an-object')
  t.is(structuralError('open'), 'not-an-object')
  t.is(structuralError({ v: 1, type: 'nuke-pot', ts: 1 }), 'unknown-type')
})

test('ops: version and ts are mandatory everywhere', t => {
  t.is(structuralError({ ...openOp(), v: 2 }), 'bad-version')
  t.is(structuralError({ ...openOp(), ts: 0 }), 'bad-ts')
  t.is(structuralError({ ...openOp(), ts: 1.5 }), 'bad-ts')
})

test('ops: open validates ranges', t => {
  t.is(structuralError(openOp({ name: '' })), 'bad-name')
  t.is(structuralError(openOp({ buyIn: 0 })), 'bad-buy-in')
  t.is(structuralError(openOp({ buyIn: 10_000_000_001 })), 'bad-buy-in')
  t.is(structuralError(openOp({ buyIn: 20.5 })), 'bad-buy-in')
  t.is(structuralError(openOp({ kickoff: -5 })), 'bad-kickoff')
  t.is(structuralError({ ...openOp(), mode: 'moneyline' }), 'bad-mode')
})

test('ops: add-writer key must be 64 lowercase hex', t => {
  const good = ops.addWriter({ key: KEYS.B, role: 'human', label: 'Bo', ts: T.before })
  t.is(structuralError(good), null)
  t.is(structuralError({ ...good, key: 'ZZ'.repeat(32) }), 'bad-key')
  t.is(structuralError({ ...good, key: 'ab' }), 'bad-key')
  t.is(structuralError({ ...good, role: 'oracle' }), 'bad-role')
})

test('ops: stake validates amount, engine and hash', t => {
  const good = ops.stake({ amount: BUY_IN, engine: 'sim', txHash: 'abc', ts: T.before })
  t.is(structuralError(good), null)
  t.is(structuralError({ ...good, amount: -1 }), 'bad-amount')
  t.is(structuralError({ ...good, amount: 0 }), 'bad-amount')
  t.is(structuralError({ ...good, engine: 'paypal' }), 'bad-engine')
  t.is(structuralError({ ...good, txHash: '' }), 'bad-tx-hash')
})

test('ops: pick validates goals and optional note', t => {
  const good = ops.pick({ home: 2, away: 1, ts: T.before })
  t.is(structuralError(good), null)
  t.is(good.note, null)
  t.is(structuralError({ ...good, home: -1 }), 'bad-score')
  t.is(structuralError({ ...good, away: 100 }), 'bad-score')
  t.is(structuralError({ ...good, home: 1.5 }), 'bad-score')
  t.is(structuralError({ ...good, note: 'x'.repeat(281) }), 'bad-note')
  t.is(structuralError({ ...good, note: 'fine' }), null)
})

test('ops: vote validates like a score', t => {
  t.is(structuralError(ops.vote({ home: 3, away: 2, ts: T.after })), null)
  t.is(structuralError(ops.vote({ home: 3, away: NaN, ts: T.after })), 'bad-score')
})

test('ops: note requires bounded text', t => {
  t.is(structuralError(ops.note({ text: 'hello', ts: T.before })), null)
  t.is(structuralError(ops.note({ text: '', ts: T.before })), 'bad-text')
  t.is(structuralError(ops.note({ text: 'x'.repeat(281), ts: T.before })), 'bad-text')
})

test('ops: settle requires engine and hash', t => {
  t.is(structuralError(ops.settle({ engine: 'sim', txHash: 'h', ts: T.after })), null)
  t.is(structuralError(ops.settle({ engine: 'cash', txHash: 'h', ts: T.after })), 'bad-engine')
})

test('ops: builders stamp protocol version and default ts', t => {
  const before = Date.now()
  const op = ops.lock()
  t.is(op.v, 1)
  t.ok(op.ts >= before)
  t.is(op.type, 'lock')
})

test('ops: kickoff constant sanity for the fixture pot', t => {
  const op = openOp()
  t.is(op.kickoff, KICKOFF)
  t.ok(op.ts < op.kickoff, 'fixture opens before kickoff')
})
