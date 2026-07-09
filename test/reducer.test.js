import test from 'brittle'
import { initialState, reduce } from '../src/core/reducer.js'
import { stateHash } from '../src/core/canonical.js'
import { payoutSum } from '../src/core/split.js'
import { REJECT, ROLE } from '../src/core/constants.js'
import { KEYS, T, BUY_IN, ops, openOp, joinedPot, stakedAndPickedPot, lockedPot } from './helpers.js'

// ── open ──────────────────────────────────────────────────────────────────

test('reducer: open creates the pot and grants the creator', t => {
  const { state, event } = reduce(initialState(), openOp(), { from: KEYS.A })
  t.ok(event.ok)
  t.is(state.pot.creator, KEYS.A)
  t.is(state.pot.buyIn, BUY_IN)
  t.is(state.writers[KEYS.A].role, ROLE.HUMAN)
  t.is(state.seq, 1)
})

test('reducer: a second open is rejected', t => {
  const first = reduce(initialState(), openOp(), { from: KEYS.A })
  const second = reduce(first.state, openOp(), { from: KEYS.B })
  t.absent(second.event.ok)
  t.is(second.event.reason, REJECT.POT_ALREADY_OPEN)
  t.is(second.state.pot.creator, KEYS.A, 'pot unchanged')
})

test('reducer: malformed ops are rejected deterministically, never thrown', t => {
  const opened = reduce(initialState(), openOp(), { from: KEYS.A })
  const out = reduce(opened.state, { v: 1, type: 'stake', ts: T.before, amount: -5, engine: 'sim', txHash: 'x' }, { from: KEYS.A })
  t.absent(out.event.ok)
  t.ok(out.event.reason.startsWith(REJECT.MALFORMED))
  t.is(out.state.seq, opened.state.seq + 1, 'rejected ops still advance seq for audit')
})

test('reducer: ops before the pot opens are rejected', t => {
  const out = reduce(initialState(), ops.join({ label: 'Bo', wallet: 'w', ts: T.before }), { from: KEYS.B })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.POT_NOT_OPEN)
})

test('reducer: missing writer attribution is malformed', t => {
  const out = reduce(initialState(), openOp(), {})
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.MALFORMED)
})

// ── add-writer ────────────────────────────────────────────────────────────

test('reducer: creator grants writers with roles', t => {
  const opened = reduce(initialState(), openOp(), { from: KEYS.A })
  const out = reduce(opened.state, ops.addWriter({ key: KEYS.G, role: 'agent', label: 'Gaffer', ts: T.before }), { from: KEYS.A })
  t.ok(out.event.ok)
  t.is(out.state.writers[KEYS.G].role, ROLE.AGENT)
  t.is(out.state.writers[KEYS.G].addedBy, KEYS.A)
})

test('reducer: non-writers cannot grant writers', t => {
  const opened = reduce(initialState(), openOp(), { from: KEYS.A })
  const out = reduce(opened.state, ops.addWriter({ key: KEYS.C, role: 'human', label: 'Cai', ts: T.before }), { from: KEYS.X })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.NOT_A_WRITER)
})

test('reducer: duplicate grant is rejected', t => {
  const { state } = joinedPot()
  const out = reduce(state, ops.addWriter({ key: KEYS.B, role: 'human', label: 'Bo again', ts: T.before }), { from: KEYS.A })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.ALREADY_GRANTED)
})

test('reducer: the AGENT cannot add writers (I6)', t => {
  const { state } = joinedPot()
  const out = reduce(state, ops.addWriter({ key: KEYS.X, role: 'agent', label: 'Second bot', ts: T.before }), { from: KEYS.G })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.AGENT_CANNOT_ADD)
})

test('reducer: any human member may grant (friends vouch friends)', t => {
  const { state } = joinedPot()
  const out = reduce(state, ops.addWriter({ key: KEYS.X, role: 'human', label: 'Dee', ts: T.before }), { from: KEYS.B })
  t.ok(out.event.ok)
  t.is(out.state.writers[KEYS.X].addedBy, KEYS.B)
})

// ── join ──────────────────────────────────────────────────────────────────

test('reducer: join requires a writer grant', t => {
  const opened = reduce(initialState(), openOp(), { from: KEYS.A })
  const out = reduce(opened.state, ops.join({ label: 'Mallory', wallet: 'w', ts: T.before }), { from: KEYS.X })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.NOT_A_WRITER)
})

test('reducer: the grant decides the role — a joiner cannot self-upgrade', t => {
  const { state } = joinedPot()
  t.is(state.members[KEYS.G].role, ROLE.AGENT, 'Gaffer joined as agent because the grant says agent')
  t.is(state.members[KEYS.B].role, ROLE.HUMAN)
})

test('reducer: double join is rejected', t => {
  const { state } = joinedPot()
  const out = reduce(state, ops.join({ label: 'Ana II', wallet: 'w2', ts: T.before }), { from: KEYS.A })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.ALREADY_JOINED)
})

test('reducer: joining a locked pot is rejected', t => {
  const { state } = lockedPot()
  const granted = reduce(state, ops.addWriter({ key: KEYS.X, role: 'human', label: 'Late', ts: T.after }), { from: KEYS.A })
  t.absent(granted.event.ok)
  t.is(granted.event.reason, REJECT.LOCKED, 'grants freeze at lock')
  const out = reduce(state, ops.join({ label: 'Late', wallet: 'w', ts: T.after }), { from: KEYS.X })
  t.absent(out.event.ok)
})

// ── stake ─────────────────────────────────────────────────────────────────

test('reducer: stake must match the buy-in exactly', t => {
  const { state } = joinedPot()
  const wrong = reduce(state, ops.stake({ amount: BUY_IN + 1, engine: 'sim', txHash: 'x', ts: T.before2 }), { from: KEYS.B })
  t.absent(wrong.event.ok)
  t.is(wrong.event.reason, REJECT.WRONG_AMOUNT)
  const right = reduce(state, ops.stake({ amount: BUY_IN, engine: 'sim', txHash: 'x', ts: T.before2 }), { from: KEYS.B })
  t.ok(right.event.ok)
  t.is(right.state.stakes[KEYS.B].amount, BUY_IN)
})

test('reducer: double stake is rejected', t => {
  const { state } = stakedAndPickedPot()
  const out = reduce(state, ops.stake({ amount: BUY_IN, engine: 'sim', txHash: 'x2', ts: T.before2 }), { from: KEYS.B })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.ALREADY_STAKED)
})

test('reducer: non-members cannot stake (I3)', t => {
  const { state } = joinedPot()
  const out = reduce(state, ops.stake({ amount: BUY_IN, engine: 'sim', txHash: 'x', ts: T.before2 }), { from: KEYS.X })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.NOT_A_MEMBER)
})

// ── pick (I1) ─────────────────────────────────────────────────────────────

test('reducer: pick requires a stake first', t => {
  const { state } = joinedPot()
  const out = reduce(state, ops.pick({ home: 1, away: 0, ts: T.before3 }), { from: KEYS.B })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.NOT_STAKED)
})

test('reducer: pick is immutable once accepted (I1)', t => {
  const { state } = stakedAndPickedPot()
  const out = reduce(state, ops.pick({ home: 5, away: 5, ts: T.before3 + 1 }), { from: KEYS.B })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.ALREADY_PICKED)
  t.is(out.state.picks[KEYS.B].home, 0, 'original pick untouched')
})

test('reducer: pick with declared ts at/after kickoff is rejected (I1)', t => {
  const { state } = joinedPot()
  const staked = reduce(state, ops.stake({ amount: BUY_IN, engine: 'sim', txHash: 'x', ts: T.before2 }), { from: KEYS.B })
  const out = reduce(staked.state, ops.pick({ home: 1, away: 0, ts: T.after }), { from: KEYS.B })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.LOCKED)
})

test('reducer: pick after the structural lock is rejected even with a backdated ts (I1)', t => {
  const { state } = lockedPot()
  // X gets no chance, but even a staked member with a lying clock is cut off
  const out = reduce(state, ops.pick({ home: 9, away: 9, ts: T.before3 }), { from: KEYS.B })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.LOCKED, 'structural cut beats a backdated timestamp')
})

test('reducer: the agent pick carries its rationale note', t => {
  const { state } = stakedAndPickedPot()
  t.is(state.picks[KEYS.G].home, 2)
  t.ok(state.picks[KEYS.G].note.includes('Backing 2-1 Brazil'))
})

// ── lock ──────────────────────────────────────────────────────────────────

test('reducer: locking before kickoff is rejected', t => {
  const { state } = stakedAndPickedPot()
  const out = reduce(state, ops.lock({ ts: T.before3 }), { from: KEYS.A })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.TOO_EARLY_TO_LOCK)
})

test('reducer: the AGENT cannot lock the pot (I6)', t => {
  const { state } = stakedAndPickedPot()
  const out = reduce(state, ops.lock({ ts: T.after }), { from: KEYS.G })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.AGENT_CANNOT_LOCK)
})

test('reducer: lock is idempotent-rejecting', t => {
  const { state } = lockedPot()
  const out = reduce(state, ops.lock({ ts: T.after2 }), { from: KEYS.B })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.ALREADY_LOCKED)
  t.is(out.state.locked.by, KEYS.A)
})

// ── vote + finality (I4) ──────────────────────────────────────────────────

test('reducer: voting before lock is rejected', t => {
  const { state } = stakedAndPickedPot()
  const out = reduce(state, ops.vote({ home: 2, away: 1, ts: T.before3 }), { from: KEYS.A })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.NOT_LOCKED)
})

test('reducer: the AGENT has no result authority (I4/I6 — no AI oracle)', t => {
  const { state } = lockedPot()
  const out = reduce(state, ops.vote({ home: 2, away: 1, ts: T.after }), { from: KEYS.G })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.AGENT_CANNOT_VOTE)
})

test('reducer: one vote does not finalize a 3-human pot', t => {
  const { state } = lockedPot()
  const out = reduce(state, ops.vote({ home: 2, away: 1, ts: T.after }), { from: KEYS.A })
  t.ok(out.event.ok)
  t.is(out.state.result, null)
  t.is(out.event.info.quorum, 2)
})

test('reducer: quorum of staked humans finalizes the result (I4)', t => {
  const { state } = lockedPot()
  const { state: s2 } = reduce(state, ops.vote({ home: 2, away: 1, ts: T.after }), { from: KEYS.A })
  const out = reduce(s2, ops.vote({ home: 2, away: 1, ts: T.after }), { from: KEYS.B })
  t.ok(out.event.ok)
  t.alike({ home: out.state.result.home, away: out.state.result.away }, { home: 2, away: 1 })
  t.ok(out.event.info.finalized)
  t.alike(out.state.result.voters, [KEYS.A, KEYS.B].sort())
})

test('reducer: disagreeing votes never finalize', t => {
  const { state } = lockedPot()
  const { state: s2 } = reduce(state, ops.vote({ home: 2, away: 1, ts: T.after }), { from: KEYS.A })
  const out = reduce(s2, ops.vote({ home: 0, away: 0, ts: T.after }), { from: KEYS.B })
  t.ok(out.event.ok)
  t.is(out.state.result, null, '1-1 tally with quorum 2 stays open')
})

test('reducer: a member can change their vote until finality', t => {
  const { state } = lockedPot()
  const { state: s2 } = reduce(state, ops.vote({ home: 0, away: 0, ts: T.after }), { from: KEYS.A })
  const { state: s3 } = reduce(s2, ops.vote({ home: 2, away: 1, ts: T.after2 }), { from: KEYS.A })
  t.is(s3.votes[KEYS.A].home, 2)
  const out = reduce(s3, ops.vote({ home: 2, away: 1, ts: T.after2 }), { from: KEYS.C })
  t.ok(out.event.info.finalized, 'revised vote counts toward quorum')
})

test('reducer: votes after finality are rejected', t => {
  const { state } = lockedPot()
  const { state: s2 } = reduce(state, ops.vote({ home: 2, away: 1, ts: T.after }), { from: KEYS.A })
  const { state: s3 } = reduce(s2, ops.vote({ home: 2, away: 1, ts: T.after }), { from: KEYS.B })
  const out = reduce(s3, ops.vote({ home: 9, away: 0, ts: T.after2 }), { from: KEYS.C })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.ALREADY_FINAL)
  t.is(out.state.result.home, 2, 'result immutable')
})

test('reducer: unstaked humans have no vote (skin in the game)', t => {
  const { state } = joinedPot()
  // B never stakes; lock via A after staking A only
  const sA = reduce(state, ops.stake({ amount: BUY_IN, engine: 'sim', txHash: 'x', ts: T.before2 }), { from: KEYS.A })
  const locked = reduce(sA.state, ops.lock({ ts: T.after }), { from: KEYS.A })
  const out = reduce(locked.state, ops.vote({ home: 1, away: 0, ts: T.after }), { from: KEYS.B })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.NOT_STAKED)
})

// ── accounting (I2) ───────────────────────────────────────────────────────

test('reducer: Σ payouts === Σ stakes — humans and the machine (I2)', t => {
  const { state } = lockedPot()
  const { state: s2 } = reduce(state, ops.vote({ home: 2, away: 1, ts: T.after }), { from: KEYS.A })
  const { state: final } = reduce(s2, ops.vote({ home: 2, away: 1, ts: T.after }), { from: KEYS.B })
  t.ok(final.splits)
  t.is(final.splits.total, BUY_IN * 4)
  t.is(payoutSum(final.splits), BUY_IN * 4)
  t.alike(final.splits.winners, [KEYS.A, KEYS.G].sort(), 'Ana AND the AI called 2-1')
  t.is(final.splits.payouts[KEYS.G], BUY_IN * 2, 'the machine wins its share')
})

test('reducer: when only the AI called it, the AI takes the pot', t => {
  const { state } = lockedPot()
  const { state: s2 } = reduce(state, ops.vote({ home: 1, away: 1, ts: T.after }), { from: KEYS.A })
  const { state: final } = reduce(s2, ops.vote({ home: 1, away: 1, ts: T.after }), { from: KEYS.B })
  t.alike(final.splits.winners, [KEYS.C], 'Cai picked 1-1')
  t.is(final.splits.payouts[KEYS.C], BUY_IN * 4)
})

test('reducer: no matching pick → deterministic refund', t => {
  const { state } = lockedPot()
  const { state: s2 } = reduce(state, ops.vote({ home: 7, away: 0, ts: T.after }), { from: KEYS.A })
  const { state: final } = reduce(s2, ops.vote({ home: 7, away: 0, ts: T.after }), { from: KEYS.B })
  t.ok(final.splits.refund)
  t.is(payoutSum(final.splits), final.splits.total)
  t.is(final.splits.payouts[KEYS.G], BUY_IN, 'agent gets its own stake back')
})

// ── notes ─────────────────────────────────────────────────────────────────

test('reducer: notes are bounded per member', t => {
  let { state } = joinedPot()
  for (let i = 0; i < 20; i++) {
    const out = reduce(state, ops.note({ text: `banter ${i}`, ts: T.before }), { from: KEYS.B })
    t.ok(out.event.ok, `note ${i} accepted`)
    state = out.state
  }
  const overflow = reduce(state, ops.note({ text: 'one too many', ts: T.before }), { from: KEYS.B })
  t.absent(overflow.event.ok)
  t.is(overflow.event.reason, REJECT.NOTE_QUOTA)
})

// ── settle ────────────────────────────────────────────────────────────────

test('reducer: settle needs a computed split', t => {
  const { state } = lockedPot()
  const out = reduce(state, ops.settle({ engine: 'sim', txHash: 'pay-1', ts: T.after2 }), { from: KEYS.A })
  t.absent(out.event.ok)
  t.is(out.event.reason, REJECT.NO_SPLIT_YET)
})

test('reducer: every staked member settles exactly once — winners and losers', t => {
  const { state } = lockedPot()
  const { state: s2 } = reduce(state, ops.vote({ home: 2, away: 1, ts: T.after }), { from: KEYS.A })
  const { state: final } = reduce(s2, ops.vote({ home: 2, away: 1, ts: T.after }), { from: KEYS.B })
  const loser = reduce(final, ops.settle({ engine: 'sim', txHash: 'pay-b', ts: T.after2 }), { from: KEYS.B })
  t.ok(loser.event.ok, 'a loser records paying out their bond')
  t.is(loser.event.info.payout, 0)
  t.is(loser.event.info.bonded, BUY_IN)
  const winner = reduce(loser.state, ops.settle({ engine: 'sim', txHash: 'pay-g', ts: T.after2 }), { from: KEYS.G })
  t.ok(winner.event.ok)
  t.is(winner.event.info.payout, BUY_IN * 2)
  const twice = reduce(winner.state, ops.settle({ engine: 'sim', txHash: 'pay-g2', ts: T.after2 }), { from: KEYS.G })
  t.absent(twice.event.ok)
  t.is(twice.event.reason, REJECT.ALREADY_SETTLED)
  const outsider = reduce(winner.state, ops.settle({ engine: 'sim', txHash: 'pay-x', ts: T.after2 }), { from: KEYS.X })
  t.absent(outsider.event.ok)
  t.is(outsider.event.reason, REJECT.NOT_STAKED)
})

// ── determinism (I5) ──────────────────────────────────────────────────────

test('reducer: identical scripts produce identical state hashes (I5)', t => {
  const a = stakedAndPickedPot().state
  const b = stakedAndPickedPot().state
  t.is(stateHash(a), stateHash(b))
})

test('reducer: state hash is independent of object key insertion order (I5)', t => {
  const { state } = stakedAndPickedPot()
  const reordered = reverseKeyOrder(state)
  t.not(JSON.stringify(state), JSON.stringify(reordered), 'insertion order really differs')
  t.is(stateHash(state), stateHash(reordered))
})

function reverseKeyOrder (value) {
  if (Array.isArray(value)) return value.map(reverseKeyOrder)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort().reverse()) out[key] = reverseKeyOrder(value[key])
    return out
  }
  return value
}

test('reducer: agent parity — same stake and pick rules as humans (I6)', t => {
  const { state, events } = stakedAndPickedPot()
  t.is(state.stakes[KEYS.G].amount, state.stakes[KEYS.A].amount)
  const agentEvents = events.filter(e => e.from === KEYS.G)
  t.ok(agentEvents.every(e => e.ok), 'agent path used the ordinary member ops')
  // and the same failure modes:
  const doubleStake = reduce(state, ops.stake({ amount: BUY_IN, engine: 'sim', txHash: 'again', ts: T.before2 }), { from: KEYS.G })
  t.is(doubleStake.event.reason, REJECT.ALREADY_STAKED)
})

test('reducer: full pot lifecycle event log stays consistent', t => {
  const joined = joinedPot()
  t.is(joined.events.length, 8, '1 open + 3 grants + 4 joins')
  t.ok(joined.events.every(e => e.ok))
  const { events } = stakedAndPickedPot()
  t.is(events.length, 8, '4 stakes + 4 picks')
  t.ok(events.every(e => e.ok))
  t.alike(events.map(e => e.seq), Array.from({ length: 8 }, (_, i) => i + 9), 'seq continues from the join batch')
})
