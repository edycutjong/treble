import test from 'brittle'
import { settlementPlan, legsFor, planTotals } from '../src/core/settlement.js'
import { computeSplit } from '../src/core/split.js'

function stateWith ({ stakes, picks, result }) {
  const splits = computeSplit({ stakes, picks, result })
  return { stakes, picks, result, splits }
}

const stake = amount => ({ amount, engine: 'sim', txHash: 'x', ts: 1 })
const pick = (home, away) => ({ home, away, note: null, ts: 1 })

test('settlement: single winner — losers pay, winner releases own bond', t => {
  const state = stateWith({
    stakes: { ana: stake(20), bob: stake(20), gaf: stake(20) },
    picks: { ana: pick(2, 1), bob: pick(0, 0), gaf: pick(1, 1) },
    result: { home: 2, away: 1 }
  })
  const plan = settlementPlan(state)
  t.alike(plan, [
    { from: 'ana', to: 'ana', amount: 20, kind: 'release' },
    { from: 'bob', to: 'ana', amount: 20, kind: 'payout' },
    { from: 'gaf', to: 'ana', amount: 20, kind: 'payout' }
  ])
})

test('settlement: every winner is made exactly whole', t => {
  const state = stateWith({
    stakes: { a: stake(10), b: stake(10), c: stake(10), d: stake(10) },
    picks: { a: pick(1, 0), b: pick(1, 0), c: pick(2, 2), d: pick(0, 3) },
    result: { home: 1, away: 0 }
  })
  const plan = settlementPlan(state)
  const { moved, received } = planTotals(plan)
  t.is(moved, 40, 'the whole pot moves')
  t.is(received.a, 20)
  t.is(received.b, 20)
  t.absent(received.c)
  t.absent(received.d)
})

test('settlement: each loser pays out exactly their stake', t => {
  const state = stateWith({
    stakes: { a: stake(15), b: stake(15), c: stake(15) },
    picks: { a: pick(3, 3), b: pick(0, 0), c: pick(0, 0) },
    result: { home: 3, away: 3 }
  })
  const plan = settlementPlan(state)
  const bLegs = legsFor(plan, 'b')
  const cLegs = legsFor(plan, 'c')
  t.is(bLegs.reduce((s, l) => s + l.amount, 0), 15)
  t.is(cLegs.reduce((s, l) => s + l.amount, 0), 15)
  t.ok(bLegs.every(l => l.to === 'a'))
})

test('settlement: refund plan is pure self-release', t => {
  const state = stateWith({
    stakes: { a: stake(20), b: stake(30) },
    picks: { a: pick(0, 0), b: pick(1, 1) },
    result: { home: 9, away: 9 }
  })
  const plan = settlementPlan(state)
  t.alike(plan, [
    { from: 'a', to: 'a', amount: 20, kind: 'release' },
    { from: 'b', to: 'b', amount: 30, kind: 'release' }
  ])
})

test('settlement: dust splits settle without imbalance', t => {
  const state = stateWith({
    stakes: { a: stake(10), b: stake(10), c: stake(10), d: stake(1) },
    picks: { a: pick(1, 0), b: pick(1, 0), c: pick(1, 0), d: pick(5, 5) },
    result: { home: 1, away: 0 }
  })
  const plan = settlementPlan(state)
  const { moved, received } = planTotals(plan)
  t.is(moved, 31)
  t.alike([received.a, received.b, received.c].sort((x, y) => y - x), [11, 10, 10])
})

test('settlement: greedy matching is deterministic across id order', t => {
  const build = () => stateWith({
    stakes: { z: stake(10), m: stake(10), a: stake(10) },
    picks: { z: pick(1, 1), m: pick(2, 0), a: pick(1, 1) },
    result: { home: 1, away: 1 }
  })
  t.alike(settlementPlan(build()), settlementPlan(build()))
  const plan = settlementPlan(build())
  // 'a' sorts before 'z' — the loser m pays a's remainder first
  const mLegs = legsFor(plan, 'm')
  t.is(mLegs[0].to, 'a')
})

test('settlement: multi-loser multi-winner chain adds up', t => {
  const state = stateWith({
    stakes: { a: stake(25), b: stake(25), c: stake(25), d: stake(25), e: stake(25) },
    picks: { a: pick(2, 1), b: pick(2, 1), c: pick(0, 0), d: pick(1, 3), e: pick(4, 4) },
    result: { home: 2, away: 1 }
  })
  const plan = settlementPlan(state)
  const { moved, received } = planTotals(plan)
  t.is(moved, 125)
  t.is(received.a + received.b, 125)
  t.is(received.a, 63, 'a receives the dust micro (62.5 → 63)')
  t.is(received.b, 62)
  for (const loser of ['c', 'd', 'e']) {
    t.is(legsFor(plan, loser).reduce((s, l) => s + l.amount, 0), 25, `${loser} pays exactly their stake`)
  }
})

test('settlement: winner with payout below stake never over-releases', t => {
  // pathological but legal if buy-ins ever differ (future modes): payout < own stake
  const plan = settlementPlan({
    stakes: { a: { amount: 30 }, b: { amount: 10 } },
    splits: { payouts: { a: 25, b: 15 }, winners: ['a', 'b'], total: 40, refund: false }
  })
  const { moved, received } = planTotals(plan)
  t.is(received.a, 25)
  t.is(received.b, 15)
  t.is(moved, 40)
})

test('settlement: refuses to run before finality', t => {
  t.exception(() => settlementPlan({ splits: null }), /no splits/)
  t.exception(() => settlementPlan({}), /no splits/)
})
