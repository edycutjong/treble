// The Treble's deterministic pot reducer.
//
// This is the consensus core: every peer feeds the same linearized ops
// (courtesy of Autobase) through this pure function and must arrive at a
// byte-identical state. It never throws on input — malformed or illegal ops
// are rejected with a deterministic reason so honest peers stay in lockstep.
//
// Invariants enforced here (see docs/AUDIT_REPORT.md for the threat model):
//   I1  Pick immutability — at most one pick per member, never after lock,
//       never with a declared ts at/after kickoff.
//   I2  Accounting — Σ payouts === Σ stakes (exact, integer micro-USD₮).
//   I3  Authority — ops are attributed to the writer core they arrived on;
//       nobody can speak for another key (Hypercore signs each append).
//   I4  Result finality — result exists iff a quorum of staked HUMANS voted
//       the same score; splits are computable only after finality.
//   I5  Determinism — same linearized log ⇒ same state hash on every peer.
//   I6  Agent parity — the AI pundit obeys the identical stake/pick/lock
//       rules as humans and has STRICTLY LESS authority: it cannot vote on
//       results, cannot lock the pot, and cannot add writers.

import { OP, ROLE, REJECT, LIMITS } from './constants.js'
import { structuralError } from './ops.js'
import { computeSplit } from './split.js'

export function initialState () {
  return {
    v: 1,
    seq: 0,
    pot: null,
    writers: {},
    members: {},
    stakes: {},
    picks: {},
    locked: null,
    votes: {},
    result: null,
    splits: null,
    settlements: {},
    notes: []
  }
}

function clone (state) {
  return JSON.parse(JSON.stringify(state))
}

function reject (state, op, from, reason) {
  const next = clone(state)
  next.seq++
  return {
    state: next,
    event: { seq: next.seq, ok: false, type: op?.type ?? 'unknown', from, reason, ts: op?.ts ?? null }
  }
}

function accept (state, op, from, info = null) {
  state.seq++
  const event = { seq: state.seq, ok: true, type: op.type, from, ts: op.ts }
  if (info) event.info = info
  return { state, event }
}

// reduce(state, op, ctx) -> { state, event }
// ctx.from — hex key of the writer core the op arrived on (I3).
export function reduce (state, op, ctx) {
  const from = ctx?.from
  if (typeof from !== 'string' || from.length === 0) {
    return reject(state, op, 'unknown', REJECT.MALFORMED)
  }

  const structural = structuralError(op)
  if (structural !== null) {
    return reject(state, op, from, `${REJECT.MALFORMED}:${structural}`)
  }

  switch (op.type) {
    case OP.OPEN: return applyOpen(clone(state), op, from)
    case OP.ADD_WRITER: return applyAddWriter(clone(state), op, from)
    case OP.JOIN: return applyJoin(clone(state), op, from)
    case OP.STAKE: return applyStake(clone(state), op, from)
    case OP.PICK: return applyPick(clone(state), op, from)
    case OP.LOCK: return applyLock(clone(state), op, from)
    case OP.VOTE: return applyVote(clone(state), op, from)
    case OP.NOTE: return applyNote(clone(state), op, from)
    case OP.SETTLE: return applySettle(clone(state), op, from)
    /* c8 ignore next -- unreachable: structuralError() already returns 'unknown-type' for any op.type absent from this switch, so the default never fires */
    default: return reject(state, op, from, REJECT.MALFORMED)
  }
}

function applyOpen (state, op, from) {
  if (state.pot !== null) return reject(state, op, from, REJECT.POT_ALREADY_OPEN)
  state.pot = {
    name: op.name,
    matchId: op.matchId,
    home: op.home,
    away: op.away,
    kickoff: op.kickoff,
    buyIn: op.buyIn,
    mode: op.mode,
    creator: from,
    openedTs: op.ts
  }
  // the creator's writer capability is implicit in owning the bootstrap core
  state.writers[from] = { role: ROLE.HUMAN, label: 'creator', addedBy: null }
  return accept(state, op, from)
}

function applyAddWriter (state, op, from) {
  if (state.pot === null) return reject(state, op, from, REJECT.POT_NOT_OPEN)
  const grantor = state.writers[from]
  if (!grantor) return reject(state, op, from, REJECT.NOT_A_WRITER)
  if (grantor.role === ROLE.AGENT) return reject(state, op, from, REJECT.AGENT_CANNOT_ADD)
  if (state.locked) return reject(state, op, from, REJECT.LOCKED)
  if (state.writers[op.key]) return reject(state, op, from, REJECT.ALREADY_GRANTED)
  state.writers[op.key] = { role: op.role, label: op.label, addedBy: from }
  return accept(state, op, from, { key: op.key, role: op.role })
}

function applyJoin (state, op, from) {
  if (state.pot === null) return reject(state, op, from, REJECT.POT_NOT_OPEN)
  const grant = state.writers[from]
  if (!grant) return reject(state, op, from, REJECT.NOT_A_WRITER)
  if (state.locked) return reject(state, op, from, REJECT.LOCKED)
  if (state.members[from]) return reject(state, op, from, REJECT.ALREADY_JOINED)
  state.members[from] = {
    label: op.label,
    wallet: op.wallet,
    role: grant.role, // the grant decides the role — a joiner cannot self-upgrade
    joinedTs: op.ts
  }
  return accept(state, op, from, { role: grant.role })
}

function applyStake (state, op, from) {
  if (state.pot === null) return reject(state, op, from, REJECT.POT_NOT_OPEN)
  if (!state.members[from]) return reject(state, op, from, REJECT.NOT_A_MEMBER)
  if (state.locked) return reject(state, op, from, REJECT.LOCKED)
  if (state.stakes[from]) return reject(state, op, from, REJECT.ALREADY_STAKED)
  if (op.amount !== state.pot.buyIn) return reject(state, op, from, REJECT.WRONG_AMOUNT)
  state.stakes[from] = { amount: op.amount, engine: op.engine, txHash: op.txHash, ts: op.ts }
  return accept(state, op, from, { amount: op.amount })
}

function applyPick (state, op, from) {
  if (state.pot === null) return reject(state, op, from, REJECT.POT_NOT_OPEN)
  if (!state.members[from]) return reject(state, op, from, REJECT.NOT_A_MEMBER)
  if (state.locked) return reject(state, op, from, REJECT.LOCKED)
  if (op.ts >= state.pot.kickoff) return reject(state, op, from, REJECT.LOCKED)
  if (!state.stakes[from]) return reject(state, op, from, REJECT.NOT_STAKED)
  if (state.picks[from]) return reject(state, op, from, REJECT.ALREADY_PICKED)
  state.picks[from] = { home: op.home, away: op.away, note: op.note, ts: op.ts }
  return accept(state, op, from, { home: op.home, away: op.away })
}

function applyLock (state, op, from) {
  if (state.pot === null) return reject(state, op, from, REJECT.POT_NOT_OPEN)
  if (!state.members[from]) return reject(state, op, from, REJECT.NOT_A_MEMBER)
  if (state.members[from].role === ROLE.AGENT) return reject(state, op, from, REJECT.AGENT_CANNOT_LOCK)
  if (state.locked) return reject(state, op, from, REJECT.ALREADY_LOCKED)
  if (op.ts < state.pot.kickoff) return reject(state, op, from, REJECT.TOO_EARLY_TO_LOCK)
  state.locked = { by: from, ts: op.ts }
  return accept(state, op, from)
}

function applyVote (state, op, from) {
  if (state.pot === null) return reject(state, op, from, REJECT.POT_NOT_OPEN)
  if (!state.members[from]) return reject(state, op, from, REJECT.NOT_A_MEMBER)
  if (state.members[from].role === ROLE.AGENT) return reject(state, op, from, REJECT.AGENT_CANNOT_VOTE)
  if (!state.locked) return reject(state, op, from, REJECT.NOT_LOCKED)
  if (!state.stakes[from]) return reject(state, op, from, REJECT.NOT_STAKED)
  if (state.result) return reject(state, op, from, REJECT.ALREADY_FINAL)

  state.votes[from] = { home: op.home, away: op.away, ts: op.ts }

  // Tally among staked human members. Quorum = strict majority.
  const eligible = Object.keys(state.members)
    .filter(id => state.members[id].role === ROLE.HUMAN && state.stakes[id])
    .sort()
  const quorum = Math.floor(eligible.length / 2) + 1
  const counts = {}
  for (const id of eligible) {
    const v = state.votes[id]
    if (!v) continue
    const key = `${v.home}-${v.away}`
    counts[key] = counts[key] || []
    counts[key].push(id)
  }
  const winning = Object.keys(counts).sort().find(key => counts[key].length >= quorum)
  let info = { tally: Object.fromEntries(Object.entries(counts).map(([k, ids]) => [k, ids.length])), quorum }

  if (winning !== undefined) {
    const [home, away] = winning.split('-').map(Number)
    state.result = { home, away, voters: counts[winning].sort(), finalizedSeq: state.seq + 1 }
    state.splits = computeSplit({ stakes: state.stakes, picks: state.picks, result: state.result })
    info = { ...info, finalized: true, result: { home, away }, total: state.splits.total, winners: state.splits.winners }
  }
  return accept(state, op, from, info)
}

function applyNote (state, op, from) {
  if (state.pot === null) return reject(state, op, from, REJECT.POT_NOT_OPEN)
  if (!state.members[from]) return reject(state, op, from, REJECT.NOT_A_MEMBER)
  const mine = state.notes.filter(n => n.from === from).length
  if (mine >= LIMITS.MAX_NOTES_PER_MEMBER) return reject(state, op, from, REJECT.NOTE_QUOTA)
  state.notes.push({ from, text: op.text, ts: op.ts })
  return accept(state, op, from)
}

function applySettle (state, op, from) {
  if (state.splits === null) return reject(state, op, from, REJECT.NO_SPLIT_YET)
  if (!state.stakes[from]) return reject(state, op, from, REJECT.NOT_STAKED)
  if (state.settlements[from]) return reject(state, op, from, REJECT.ALREADY_SETTLED)
  state.settlements[from] = { engine: op.engine, txHash: op.txHash, ts: op.ts }
  // every staked member settles exactly once: winners release their bond,
  // losers pay theirs out — both record the executed legs' receipt here
  return accept(state, op, from, { bonded: state.stakes[from].amount, payout: state.splits.payouts[from] ?? 0 })
}

// Convenience for tests, the demo and the bench: apply a scripted sequence.
export function reduceMany (state, entries) {
  const events = []
  let current = state
  for (const { op, from } of entries) {
    const out = reduce(current, op, { from })
    current = out.state
    events.push(out.event)
  }
  return { state: current, events }
}
