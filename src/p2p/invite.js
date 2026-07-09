// Pot invites: `treble1<z32-of-bootstrap-key>`.
// The invite IS the membership secret — the swarm discovery key is derived
// from it, so only invite holders can even find the pot. Writer capability is
// still granted explicitly by a human at the table (add-writer op).

import z32 from 'z32'
import b4a from 'b4a'

const PREFIX = 'treble1'

export function encodeInvite (key) {
  return PREFIX + z32.encode(key)
}

export function decodeInvite (invite) {
  if (typeof invite !== 'string' || !invite.startsWith(PREFIX)) {
    throw new Error(`not a Treble invite (expected "${PREFIX}…"): ${invite}`)
  }
  const key = z32.decode(invite.slice(PREFIX.length))
  if (key.length !== 32) throw new Error('invalid invite: key must be 32 bytes')
  return key
}

export function shortKey (hexOrBuf, len = 8) {
  const hex = typeof hexOrBuf === 'string' ? hexOrBuf : b4a.toString(hexOrBuf, 'hex')
  return `${hex.slice(0, len)}…${hex.slice(-4)}`
}
