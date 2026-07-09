// SimLedger — a deterministic, LOCAL USD₮ settlement ledger.
//
// This is the demo/CI settlement engine and it is ALWAYS disclosed as such in
// the UI, CLI and README ("engine: sim"). It exists so the entire pot flow —
// including the AI pundit autonomously staking under a WDK Transaction
// Policy — runs end-to-end offline with real value conservation, and so tests
// can assert money movement byte-for-byte. Swapping `engine: 'sim'` for a
// funded chain module (e.g. @tetherto/wdk-wallet-solana on devnet) changes
// configuration, not code paths.

import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import { stableStringify } from '../core/canonical.js'
import { assertMicro } from '../core/money.js'

export const USDT = 'USDT'

export class SimLedger {
  constructor () {
    this._balances = new Map()
    this._history = []
    this._nonce = 0
  }

  faucet (address, amount) {
    assertMicro(amount, 'faucet amount')
    this._balances.set(address, this.balance(address) + amount)
    return this._record({ kind: 'faucet', from: 'faucet', to: address, amount })
  }

  balance (address) {
    return this._balances.get(address) ?? 0
  }

  transfer ({ from, to, amount, memo = '' }) {
    assertMicro(amount, 'transfer amount')
    if (amount === 0) throw new Error('transfer amount must be positive')
    const available = this.balance(from)
    if (available < amount) {
      throw new Error(`insufficient funds: ${from} holds ${available}µ, tried to send ${amount}µ`)
    }
    this._balances.set(from, available - amount)
    this._balances.set(to, this.balance(to) + amount)
    return this._record({ kind: 'transfer', from, to, amount, memo })
  }

  // Total actually spent by an address (used for cumulative policy caps —
  // simulations never appear here, only executed transfers).
  spent (address) {
    return this._history
      .filter(entry => entry.kind === 'transfer' && entry.from === address)
      .reduce((sum, entry) => sum + entry.amount, 0)
  }

  history (address = null) {
    if (address === null) return [...this._history]
    return this._history.filter(entry => entry.from === address || entry.to === address)
  }

  totalSupply () {
    let sum = 0
    for (const value of this._balances.values()) sum += value
    return sum
  }

  _record (entry) {
    const nonce = this._nonce++
    const hash = 'sim0x' + b4a.toString(
      crypto.hash(b4a.from(stableStringify({ ...entry, nonce }))), 'hex'
    ).slice(0, 40)
    const record = { ...entry, nonce, hash, ts: Date.now() }
    this._history.push(record)
    return { hash, fee: 0 }
  }
}
