// Deterministic pot split.
//
// Invariant: Σ payouts === Σ stakes, exactly, in integer micro-USD₮.
// Winners are the staked members whose pick matches the final score exactly.
// If nobody matched, every staked member is refunded their stake.
// Integer division dust is assigned 1µ at a time to winners in ascending
// participant-id order — arbitrary but identical on every honest peer.

export function computeSplit ({ stakes, picks, result }) {
  const stakers = Object.keys(stakes).sort()
  const total = stakers.reduce((sum, id) => sum + stakes[id].amount, 0)

  const matchers = stakers.filter(id => {
    const p = picks[id]
    return p && p.home === result.home && p.away === result.away
  })

  if (matchers.length === 0) {
    // no winner — deterministic refund of each member's own stake
    const payouts = {}
    for (const id of stakers) payouts[id] = stakes[id].amount
    return { total, winners: stakers, payouts, refund: true }
  }

  const share = Math.floor(total / matchers.length)
  const dust = total - share * matchers.length
  const payouts = {}
  matchers.forEach((id, i) => {
    payouts[id] = share + (i < dust ? 1 : 0)
  })
  return { total, winners: matchers, payouts, refund: false }
}

export function payoutSum (splits) {
  return Object.values(splits.payouts).reduce((a, b) => a + b, 0)
}
