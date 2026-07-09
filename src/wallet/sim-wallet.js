// SimWalletManager — a custom chain module for @tetherto/wdk.
//
// WDK is explicitly modular: `new WDK(seed).registerWallet(name, Manager,
// config)` accepts any manager built on @tetherto/wdk-wallet's base classes.
// This one settles on the local SimLedger (disclosed sim engine). Because it
// goes through the real WDK pipeline, the REAL WDK Transaction Policy engine
// governs its accounts — the AI pundit's spend cap is enforced by Tether's
// own default-deny engine, not by our code.

import WalletManager, { IWalletAccount } from '@tetherto/wdk-wallet'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import z32 from 'z32'
import { USDT } from './sim-ledger.js'

export class SimWalletAccount extends IWalletAccount {
  constructor ({ index, seed, ledger }) {
    super()
    this._index = index
    this._ledger = ledger
    // deterministic per (seed, index): blake2b(seed ‖ index) seeds an ed25519 pair
    const material = b4a.concat([seed, b4a.from(String(index))])
    this._keyPair = crypto.keyPair(crypto.hash(material))
    this._disposed = false
  }

  get index () {
    return this._index
  }

  get path () {
    return `m/7342'/0'/${this._index}'`
  }

  get keyPair () {
    return {
      publicKey: this._keyPair.publicKey,
      privateKey: this._disposed ? null : this._keyPair.secretKey
    }
  }

  async getAddress () {
    return 'sim1' + z32.encode(this._keyPair.publicKey)
  }

  async getBalance (token = USDT) {
    if (token !== USDT) throw new Error(`sim ledger only tracks USD₮, got ${token}`)
    return this._ledger.balance(await this.getAddress())
  }

  async sign (message) {
    if (this._disposed) throw new Error('account disposed')
    const signature = crypto.sign(b4a.from(message), this._keyPair.secretKey)
    return b4a.toString(signature, 'hex')
  }

  async verify (message, signature) {
    return crypto.verify(b4a.from(message), b4a.from(signature, 'hex'), this._keyPair.publicKey)
  }

  async transfer ({ token = USDT, recipient, amount }) {
    if (this._disposed) throw new Error('account disposed')
    if (token !== USDT) throw new Error(`sim ledger only settles USD₮, got ${token}`)
    const from = await this.getAddress()
    const { hash, fee } = this._ledger.transfer({ from, to: recipient, amount })
    return { hash, fee }
  }

  async quoteTransfer () {
    return { fee: 0 } // the sim ledger is feeless, like a gasless USD₮ flow
  }

  async toReadOnlyAccount () {
    const address = await this.getAddress()
    const ledger = this._ledger
    return {
      getAddress: async () => address,
      getBalance: async (token = USDT) => {
        if (token !== USDT) throw new Error(`sim ledger only tracks USD₮, got ${token}`)
        return ledger.balance(address)
      }
    }
  }

  dispose () {
    this._disposed = true
  }
}

export default class SimWalletManager extends WalletManager {
  constructor (seed, config = {}) {
    super(seed, config)
    if (!config.ledger) throw new Error('SimWalletManager requires { ledger: SimLedger }')
    this._ledger = config.ledger
  }

  async getAccount (index = 0) {
    const path = `m/7342'/0'/${index}'`
    if (!this._accounts[path]) {
      this._accounts[path] = new SimWalletAccount({ index, seed: this._seed, ledger: this._ledger })
    }
    return this._accounts[path]
  }

  async getAccountByPath (path) {
    const match = /^m\/7342'\/0'\/(\d+)'$/.exec(path)
    if (!match) throw new Error(`unsupported sim derivation path: ${path}`)
    return this.getAccount(Number(match[1]))
  }

  async getFeeRates () {
    return { normal: 0n, fast: 0n }
  }
}
