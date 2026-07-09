// Edge/branch coverage for the pure core modules — the deterministic rejection
// and guard paths the happy-path suites don't reach, so every consensus guard
// is proven to fire identically on every honest peer.

import test from 'brittle'
import { initialState, reduce, reduceMany } from '../src/core/reducer.js'
import { stableStringify } from '../src/core/canonical.js'
import { structuralError } from '../src/core/ops.js'
import { settlementPlan } from '../src/core/settlement.js'
import { REJECT } from '../src/core/constants.js'
import { KEYS, T, BUY_IN, ops, openOp } from './helpers.js'

// ── canonical.js: the unsupported-type guard ────────────────────────────────

test('canonical: unsupported value types throw the last-resort guard', t => {
  t.exception.all(() => stableStringify(() => {}), /unsupported type/, 'a function is not canonicalizable')
  t.exception.all(() => stableStringify({ nested: Symbol('x') }), /unsupported type/, 'a symbol is not canonicalizable')
})

// ── ops.js: each field-level structural rejection ───────────────────────────

test('ops: open rejects each bad text field on its own line', t => {
  t.is(structuralError(openOp({ matchId: '' })), 'bad-match-id')
  t.is(structuralError(openOp({ home: '' })), 'bad-home')
  t.is(structuralError(openOp({ away: 'x'.repeat(41) })), 'bad-away')
})

test('ops: add-writer rejects an empty label', t => {
  t.is(structuralError(ops.addWriter({ key: KEYS.B, role: 'human', label: '', ts: T.before })), 'bad-label')
})

test('ops: join rejects a bad label and a bad wallet', t => {
  t.is(structuralError(ops.join({ label: '', wallet: 'w', ts: T.before })), 'bad-label')
  t.is(structuralError(ops.join({ label: 'Bo', wallet: '', ts: T.before })), 'bad-wallet')
})

test('ops: settle rejects an empty tx hash', t => {
  t.is(structuralError(ops.settle({ engine: 'sim', txHash: '', ts: T.after })), 'bad-tx-hash')
})

// ── reducer.js: the pot-null and not-a-member guards for every op ────────────

test('reducer: a null op is rejected as malformed, never thrown', t => {
  const { event, state } = reduce(initialState(), null, { from: KEYS.A })
  t.absent(event.ok)
  t.is(event.reason, REJECT.MALFORMED + ':not-an-object')
  t.is(event.type, 'unknown', 'no op.type to read ⇒ "unknown"')
  t.is(event.ts, null, 'no op.ts to read ⇒ null')
  t.is(state.seq, 1, 'even a null op advances seq for the audit trail')
})

test('reducer: every ledger op before the pot opens is POT_NOT_OPEN', t => {
  const s = initialState()
  const cases = [
    ops.addWriter({ key: KEYS.B, role: 'human', label: 'Bo', ts: T.before }),
    ops.stake({ amount: BUY_IN, engine: 'sim', txHash: 'x', ts: T.before }),
    ops.pick({ home: 1, away: 0, ts: T.before }),
    ops.lock({ ts: T.after }),
    ops.vote({ home: 1, away: 0, ts: T.after }),
    ops.note({ text: 'hi', ts: T.before })
  ]
  for (const op of cases) {
    const out = reduce(s, op, { from: KEYS.A })
    t.absent(out.event.ok, `${op.type} rejected before open`)
    t.is(out.event.reason, REJECT.POT_NOT_OPEN, `${op.type} → pot-not-open`)
  }
})

test('reducer: pick/lock/vote/note by a non-member are NOT_A_MEMBER', t => {
  const opened = reduce(initialState(), openOp(), { from: KEYS.A }).state
  const cases = [
    ops.pick({ home: 1, away: 0, ts: T.before }),
    ops.lock({ ts: T.after }),
    ops.vote({ home: 1, away: 0, ts: T.after }),
    ops.note({ text: 'hi', ts: T.before })
  ]
  for (const op of cases) {
    const out = reduce(opened, op, { from: KEYS.X })
    t.absent(out.event.ok, `${op.type} rejected for a stranger`)
    t.is(out.event.reason, REJECT.NOT_A_MEMBER, `${op.type} → not-a-member`)
  }
})

test('reducer: staking and joining freeze the instant the pot locks', t => {
  const built = reduceMany(initialState(), [
    { op: openOp(), from: KEYS.A },
    { op: ops.addWriter({ key: KEYS.B, role: 'human', label: 'Bo', ts: T.before }), from: KEYS.A },
    { op: ops.addWriter({ key: KEYS.X, role: 'human', label: 'Dee', ts: T.before }), from: KEYS.A },
    { op: ops.join({ label: 'Ana', wallet: 'a', ts: T.before }), from: KEYS.A },
    { op: ops.join({ label: 'Bo', wallet: 'b', ts: T.before }), from: KEYS.B },
    { op: ops.lock({ ts: T.after }), from: KEYS.A }
  ])

  // Bo is a member who never staked; the lock cuts him off (L137)
  const stakeLocked = reduce(built.state, ops.stake({ amount: BUY_IN, engine: 'sim', txHash: 'x', ts: T.after }), { from: KEYS.B })
  t.absent(stakeLocked.event.ok)
  t.is(stakeLocked.event.reason, REJECT.LOCKED, 'no staking after kickoff')

  // Dee is a granted writer who never joined; the lock cuts her off too (L123)
  const joinLocked = reduce(built.state, ops.join({ label: 'Dee', wallet: 'd', ts: T.after }), { from: KEYS.X })
  t.absent(joinLocked.event.ok)
  t.is(joinLocked.event.reason, REJECT.LOCKED, 'no joining after kickoff')
})

// ── settlement.js: the "impossible if Σ payouts == Σ stakes" imbalance guards ─

test('settlement: refuses an under-funded plan (Σ payouts < Σ stakes)', t => {
  t.exception(() => settlementPlan({
    stakes: { a: { amount: 20 }, b: { amount: 20 } },
    splits: { payouts: { a: 10 }, winners: ['a'], total: 40, refund: false }
  }), /surplus with no creditor/, 'a loser bond with nobody to pay is a broken invariant')
})

test('settlement: refuses an over-funded plan (Σ payouts > Σ stakes)', t => {
  t.exception(() => settlementPlan({
    stakes: { a: { amount: 10 }, b: { amount: 10 } },
    splits: { payouts: { a: 30, b: 0 }, winners: ['a'], total: 20, refund: false }
  }), /creditor left unpaid/, 'a creditor with nobody left to pay them is a broken invariant')
})
