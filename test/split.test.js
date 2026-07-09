import test from 'brittle'
import { computeSplit, payoutSum } from '../src/core/split.js'

const stake = amount => ({ amount, engine: 'sim', txHash: 'x', ts: 1 })
const pick = (home, away) => ({ home, away, note: null, ts: 1 })

test('split: single winner takes the whole pot', t => {
  const out = computeSplit({
    stakes: { a: stake(20), b: stake(20), c: stake(20) },
    picks: { a: pick(2, 1), b: pick(0, 0), c: pick(1, 1) },
    result: { home: 2, away: 1 }
  })
  t.is(out.total, 60)
  t.alike(out.winners, ['a'])
  t.is(out.payouts.a, 60)
  t.is(out.refund, false)
})

test('split: two winners share equally', t => {
  const out = computeSplit({
    stakes: { a: stake(20), b: stake(20), c: stake(20), d: stake(20) },
    picks: { a: pick(2, 1), b: pick(2, 1), c: pick(0, 0), d: pick(3, 0) },
    result: { home: 2, away: 1 }
  })
  t.alike(out.winners, ['a', 'b'])
  t.is(out.payouts.a, 40)
  t.is(out.payouts.b, 40)
})

test('split: Σ payouts === Σ stakes even with dust', t => {
  const out = computeSplit({
    stakes: { a: stake(10), b: stake(10), c: stake(10) },
    picks: { a: pick(1, 0), b: pick(1, 0), c: pick(1, 0) },
    result: { home: 1, away: 0 }
  })
  // 30 / 3 = 10 clean; force dust with an uneven pot
  t.is(payoutSum(out), 30)

  const dusty = computeSplit({
    stakes: { a: stake(10), b: stake(10), c: stake(10), d: stake(1) },
    picks: { a: pick(1, 0), b: pick(1, 0), c: pick(1, 0), d: pick(9, 9) },
    result: { home: 1, away: 0 }
  })
  t.is(dusty.total, 31)
  t.is(payoutSum(dusty), 31, 'dust never mints or burns')
  t.alike(Object.values(dusty.payouts).sort((x, y) => y - x), [11, 10, 10])
})

test('split: dust goes to lexicographically-first winners', t => {
  const out = computeSplit({
    stakes: { zed: stake(10), amy: stake(10), bob: stake(11) },
    picks: { zed: pick(1, 1), amy: pick(1, 1), bob: pick(1, 1) },
    result: { home: 1, away: 1 }
  })
  t.is(out.total, 31)
  t.is(out.payouts.amy, 11, 'amy sorts first, gets the extra micro')
  t.is(out.payouts.bob, 10)
  t.is(out.payouts.zed, 10)
})

test('split: nobody matched → full refund', t => {
  const out = computeSplit({
    stakes: { a: stake(20), b: stake(30) },
    picks: { a: pick(0, 0), b: pick(1, 1) },
    result: { home: 5, away: 4 }
  })
  t.is(out.refund, true)
  t.alike(out.winners, ['a', 'b'])
  t.is(out.payouts.a, 20)
  t.is(out.payouts.b, 30)
  t.is(payoutSum(out), 50)
})

test('split: staker without a pick can never win, but their stake stays in the pot', t => {
  const out = computeSplit({
    stakes: { a: stake(20), b: stake(20) },
    picks: { a: pick(2, 0) },
    result: { home: 2, away: 0 }
  })
  t.alike(out.winners, ['a'])
  t.is(out.payouts.a, 40, 'winner receives the no-pick stake too')
  t.is(payoutSum(out), out.total)
})

test('split: refund with no picks at all', t => {
  const out = computeSplit({
    stakes: { a: stake(5), b: stake(5) },
    picks: {},
    result: { home: 1, away: 0 }
  })
  t.is(out.refund, true)
  t.is(payoutSum(out), 10)
})

test('split: deterministic across key insertion order', t => {
  const s1 = computeSplit({
    stakes: { b: stake(10), a: stake(10) },
    picks: { b: pick(1, 0), a: pick(1, 0) },
    result: { home: 1, away: 0 }
  })
  const s2 = computeSplit({
    stakes: { a: stake(10), b: stake(10) },
    picks: { a: pick(1, 0), b: pick(1, 0) },
    result: { home: 1, away: 0 }
  })
  t.alike(s1, s2)
})
