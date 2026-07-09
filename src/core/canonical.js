// Canonical (deterministic) serialization + hashing.
// Two honest peers must produce byte-identical state hashes, so object key
// order can never leak into the ledger.

import crypto from 'hypercore-crypto'
import b4a from 'b4a'

export function stableStringify (value) {
  return JSON.stringify(sortValue(value))
}

function sortValue (value) {
  if (value === null) return null
  const type = typeof value
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number in canonical value')
    return value
  }
  if (type === 'string' || type === 'boolean') return value
  if (type === 'undefined') throw new TypeError('undefined in canonical value')
  if (type === 'bigint') throw new TypeError('bigint in canonical value (use micro-int numbers)')
  if (Array.isArray(value)) return value.map(sortValue)
  if (type === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      out[key] = sortValue(value[key])
    }
    return out
  }
  throw new TypeError(`unsupported type in canonical value: ${type}`)
}

export function hashValue (value) {
  return b4a.toString(crypto.hash(b4a.from(stableStringify(value))), 'hex')
}

export function stateHash (state) {
  return hashValue(state)
}
