// Deterministic escrowless settlement.
//
// There is no escrow contract and no treasurer. At stake time every
// participant ring-fences their buy-in into their OWN pot-bond sub-account
// (self-custody preserved, movement visible on the settlement engine). After
// the result finalizes, every honest client executes the same plan computed
// here:
//   • each winner releases min(stake, payout) from their own bond back to
//     their main account,
//   • each loser's bond pays the winners' remainders, matched greedily in
//     ascending id order (deterministic on every peer).
//
// Invariants: Σ legs out of a loser's bond === their stake; every winner
// receives exactly their payout; no leg is negative; total moved === pot.
// The trust gap (a dishonest peer could refuse to execute their legs) is
// documented in docs/AUDIT_REPORT.md — the debt record itself is
// tamper-evident either way.

export function settlementPlan (state) {
  if (!state?.splits) throw new Error('no splits computed yet — settle after finality')
  const { payouts } = state.splits
  const stakes = state.stakes

  const ids = Object.keys(stakes).sort()
  const legs = []

  // winners self-release the part of their payout covered by their own bond
  const stillOwed = {}
  for (const id of ids) {
    const stake = stakes[id].amount
    const payout = payouts[id] ?? 0
    const keep = Math.min(stake, payout)
    if (keep > 0) legs.push({ from: id, to: id, amount: keep, kind: 'release' })
    const owed = payout - keep
    if (owed > 0) stillOwed[id] = owed
  }

  // losers' bonds cover the remainders, deterministically
  const creditors = Object.keys(stillOwed).sort()
  let creditorIndex = 0
  for (const id of ids) {
    const stake = stakes[id].amount
    const payout = payouts[id] ?? 0
    let surplus = stake - Math.min(stake, payout)
    while (surplus > 0 && creditorIndex < creditors.length) {
      const creditor = creditors[creditorIndex]
      const amount = Math.min(surplus, stillOwed[creditor])
      legs.push({ from: id, to: creditor, amount, kind: 'payout' })
      surplus -= amount
      stillOwed[creditor] -= amount
      if (stillOwed[creditor] === 0) creditorIndex++
    }
    if (surplus > 0) throw new Error('settlement imbalance: surplus with no creditor (impossible if Σ payouts == Σ stakes)')
  }
  if (creditorIndex < creditors.length) {
    throw new Error('settlement imbalance: creditor left unpaid (impossible if Σ payouts == Σ stakes)')
  }

  return legs
}

export function legsFor (plan, id) {
  return plan.filter(leg => leg.from === id)
}

export function planTotals (plan) {
  const moved = plan.reduce((sum, leg) => sum + leg.amount, 0)
  const received = {}
  for (const leg of plan) received[leg.to] = (received[leg.to] ?? 0) + leg.amount
  return { moved, received }
}
