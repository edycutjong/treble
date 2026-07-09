// Op builders + structural validation.
// Builders are used by peers to append; validation runs inside the reducer so
// every peer rejects malformed input identically (never throws — returns errors).

import { OP, ROLE, POT_MODE, LIMITS, ENGINE, PROTOCOL_VERSION } from './constants.js'
import { isMicroAmount } from './money.js'

const HEX_RE = /^[0-9a-f]+$/

export function openPot ({ name, matchId, home, away, kickoff, buyIn, mode = POT_MODE.EXACT_SCORE, ts = Date.now() }) {
  return { v: PROTOCOL_VERSION, type: OP.OPEN, ts, name, matchId, home, away, kickoff, buyIn, mode }
}

export function addWriter ({ key, role, label, ts = Date.now() }) {
  return { v: PROTOCOL_VERSION, type: OP.ADD_WRITER, ts, key, role, label }
}

export function join ({ label, wallet, ts = Date.now() }) {
  return { v: PROTOCOL_VERSION, type: OP.JOIN, ts, label, wallet }
}

export function stake ({ amount, engine, txHash, ts = Date.now() }) {
  return { v: PROTOCOL_VERSION, type: OP.STAKE, ts, amount, engine, txHash }
}

export function pick ({ home, away, note = null, ts = Date.now() }) {
  return { v: PROTOCOL_VERSION, type: OP.PICK, ts, home, away, note }
}

export function lock ({ ts = Date.now() } = {}) {
  return { v: PROTOCOL_VERSION, type: OP.LOCK, ts }
}

export function vote ({ home, away, ts = Date.now() }) {
  return { v: PROTOCOL_VERSION, type: OP.VOTE, ts, home, away }
}

export function note ({ text, ts = Date.now() }) {
  return { v: PROTOCOL_VERSION, type: OP.NOTE, ts, text }
}

export function settle ({ engine, txHash, ts = Date.now() }) {
  return { v: PROTOCOL_VERSION, type: OP.SETTLE, ts, engine, txHash }
}

// ── structural validation ────────────────────────────────────────────────

function isTs (value) {
  return Number.isSafeInteger(value) && value > 0
}

function isGoals (value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= LIMITS.MAX_GOALS
}

function isText (value, max, min = 1) {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function isHexKey (value) {
  return typeof value === 'string' && value.length === LIMITS.KEY_HEX_LENGTH && HEX_RE.test(value)
}

function isEngine (value) {
  return value === ENGINE.SIM || value === ENGINE.SOLANA
}

function isTxHash (value) {
  return isText(value, LIMITS.MAX_TX_HASH)
}

function isRole (value) {
  return value === ROLE.HUMAN || value === ROLE.AGENT
}

// Returns null when structurally valid, otherwise a short reason string.
export function structuralError (op) {
  if (typeof op !== 'object' || op === null || Array.isArray(op)) return 'not-an-object'
  if (op.v !== PROTOCOL_VERSION) return 'bad-version'
  if (!isTs(op.ts)) return 'bad-ts'

  switch (op.type) {
    case OP.OPEN:
      if (!isText(op.name, LIMITS.MAX_NAME)) return 'bad-name'
      if (!isText(op.matchId, LIMITS.MAX_MATCH_ID)) return 'bad-match-id'
      if (!isText(op.home, LIMITS.MAX_LABEL)) return 'bad-home'
      if (!isText(op.away, LIMITS.MAX_LABEL)) return 'bad-away'
      if (!isTs(op.kickoff)) return 'bad-kickoff'
      if (!isMicroAmount(op.buyIn) || op.buyIn < LIMITS.MIN_BUY_IN || op.buyIn > LIMITS.MAX_BUY_IN) return 'bad-buy-in'
      if (op.mode !== POT_MODE.EXACT_SCORE) return 'bad-mode'
      return null
    case OP.ADD_WRITER:
      if (!isHexKey(op.key)) return 'bad-key'
      if (!isRole(op.role)) return 'bad-role'
      if (!isText(op.label, LIMITS.MAX_LABEL)) return 'bad-label'
      return null
    case OP.JOIN:
      if (!isText(op.label, LIMITS.MAX_LABEL)) return 'bad-label'
      if (!isText(op.wallet, LIMITS.MAX_TX_HASH)) return 'bad-wallet'
      return null
    case OP.STAKE:
      if (!isMicroAmount(op.amount) || op.amount < LIMITS.MIN_BUY_IN) return 'bad-amount'
      if (!isEngine(op.engine)) return 'bad-engine'
      if (!isTxHash(op.txHash)) return 'bad-tx-hash'
      return null
    case OP.PICK:
      if (!isGoals(op.home) || !isGoals(op.away)) return 'bad-score'
      if (op.note !== null && !isText(op.note, LIMITS.MAX_NOTE)) return 'bad-note'
      return null
    case OP.LOCK:
      return null
    case OP.VOTE:
      if (!isGoals(op.home) || !isGoals(op.away)) return 'bad-score'
      return null
    case OP.NOTE:
      if (!isText(op.text, LIMITS.MAX_NOTE)) return 'bad-text'
      return null
    case OP.SETTLE:
      if (!isEngine(op.engine)) return 'bad-engine'
      if (!isTxHash(op.txHash)) return 'bad-tx-hash'
      return null
    default:
      return 'unknown-type'
  }
}
