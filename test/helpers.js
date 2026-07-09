// Shared fixtures for reducer tests: a Brazil–Argentina pot with three humans
// (Ana, Bo, Cai) and one AI pundit (Gaffer). Keys are stable 64-hex ids so the
// deterministic dust rule is predictable in assertions.

import { initialState, reduceMany } from '../src/core/reducer.js'
import * as ops from '../src/core/ops.js'
import { toMicro } from '../src/core/money.js'

export const KICKOFF = 1_780_000_000_000

export const T = {
  before: KICKOFF - 60_000,
  before2: KICKOFF - 50_000,
  before3: KICKOFF - 40_000,
  after: KICKOFF + 60_000,
  after2: KICKOFF + 120_000
}

export const KEYS = {
  A: 'aa'.repeat(32), // Ana — creator
  B: 'bb'.repeat(32), // Bo
  C: 'cc'.repeat(32), // Cai
  G: 'dd'.repeat(32), // Gaffer — the AI pundit
  X: 'ee'.repeat(32) // outsider (never granted)
}

export const BUY_IN = toMicro('20')

export function openOp (overrides = {}) {
  return ops.openPot({
    name: 'Kitchen Table Clasico',
    matchId: 'wc2026-bra-arg',
    home: 'Brazil',
    away: 'Argentina',
    kickoff: KICKOFF,
    buyIn: BUY_IN,
    ts: T.before,
    ...overrides
  })
}

// Pot with writers granted for B (human), C (human), G (agent); all joined.
export function joinedPot () {
  const script = [
    { op: openOp(), from: KEYS.A },
    { op: ops.addWriter({ key: KEYS.B, role: 'human', label: 'Bo', ts: T.before }), from: KEYS.A },
    { op: ops.addWriter({ key: KEYS.C, role: 'human', label: 'Cai', ts: T.before }), from: KEYS.A },
    { op: ops.addWriter({ key: KEYS.G, role: 'agent', label: 'Gaffer', ts: T.before }), from: KEYS.A },
    { op: ops.join({ label: 'Ana', wallet: 'addr-ana', ts: T.before }), from: KEYS.A },
    { op: ops.join({ label: 'Bo', wallet: 'addr-bo', ts: T.before }), from: KEYS.B },
    { op: ops.join({ label: 'Cai', wallet: 'addr-cai', ts: T.before }), from: KEYS.C },
    { op: ops.join({ label: 'Gaffer', wallet: 'addr-gaffer', ts: T.before }), from: KEYS.G }
  ]
  return reduceMany(initialState(), script)
}

// Everyone staked; picks: Ana 2-1, Bo 0-0, Cai 1-1, Gaffer 2-1.
export function stakedAndPickedPot () {
  const { state } = joinedPot()
  const script = []
  for (const key of [KEYS.A, KEYS.B, KEYS.C, KEYS.G]) {
    script.push({ op: ops.stake({ amount: BUY_IN, engine: 'sim', txHash: `tx-${key.slice(0, 4)}`, ts: T.before2 }), from: key })
  }
  script.push({ op: ops.pick({ home: 2, away: 1, ts: T.before3 }), from: KEYS.A })
  script.push({ op: ops.pick({ home: 0, away: 0, ts: T.before3 }), from: KEYS.B })
  script.push({ op: ops.pick({ home: 1, away: 1, ts: T.before3 }), from: KEYS.C })
  script.push({ op: ops.pick({ home: 2, away: 1, note: 'Backing 2-1 Brazil — the press leaves the flank open.', ts: T.before3 }), from: KEYS.G })
  return reduceMany(state, script)
}

export function lockedPot () {
  const { state } = stakedAndPickedPot()
  return reduceMany(state, [{ op: ops.lock({ ts: T.after }), from: KEYS.A }])
}

export { ops }
