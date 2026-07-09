// Protocol constants for The Treble pot ledger.
// Every limit here is consensus-bearing: changing one changes state hashes.

export const PROTOCOL_VERSION = 1

export const OP = Object.freeze({
  OPEN: 'open',
  ADD_WRITER: 'add-writer',
  JOIN: 'join',
  STAKE: 'stake',
  PICK: 'pick',
  LOCK: 'lock',
  VOTE: 'vote',
  NOTE: 'note',
  SETTLE: 'settle'
})

export const ROLE = Object.freeze({
  HUMAN: 'human',
  AGENT: 'agent'
})

export const POT_MODE = Object.freeze({
  EXACT_SCORE: 'exact-score'
})

export const LIMITS = Object.freeze({
  MAX_GOALS: 99,
  MAX_LABEL: 40,
  MAX_NOTE: 280,
  MAX_NOTES_PER_MEMBER: 20,
  MAX_NAME: 60,
  MAX_MATCH_ID: 80,
  // 10,000 USD₮ in micro units — sanity ceiling for a friends pot
  MAX_BUY_IN: 10_000_000_000,
  MIN_BUY_IN: 1,
  KEY_HEX_LENGTH: 64,
  MAX_TX_HASH: 128
})

export const ENGINE = Object.freeze({
  SIM: 'sim',
  SOLANA: 'solana'
})

export const REJECT = Object.freeze({
  MALFORMED: 'malformed-op',
  POT_ALREADY_OPEN: 'pot-already-open',
  POT_NOT_OPEN: 'pot-not-open',
  NOT_A_WRITER: 'not-a-writer',
  NOT_A_MEMBER: 'not-a-member',
  ALREADY_GRANTED: 'writer-already-granted',
  ALREADY_JOINED: 'already-joined',
  ROLE_MISMATCH: 'role-mismatch',
  NOT_STAKED: 'not-staked',
  ALREADY_STAKED: 'already-staked',
  WRONG_AMOUNT: 'stake-must-equal-buy-in',
  ALREADY_PICKED: 'pick-already-locked-in',
  LOCKED: 'pot-locked-at-kickoff',
  NOT_LOCKED: 'pot-not-locked-yet',
  ALREADY_LOCKED: 'already-locked',
  TOO_EARLY_TO_LOCK: 'lock-before-kickoff',
  AGENT_CANNOT_LOCK: 'agent-cannot-lock',
  AGENT_CANNOT_VOTE: 'agent-has-no-result-authority',
  AGENT_CANNOT_ADD: 'agent-cannot-add-writers',
  ALREADY_FINAL: 'result-already-final',
  NOTE_QUOTA: 'note-quota-exceeded',
  NO_SPLIT_YET: 'no-split-computed',
  ALREADY_SETTLED: 'already-settled'
})
