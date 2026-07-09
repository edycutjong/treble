// Coverage for the wallet + invite surface the happy-path suite doesn't reach:
// the SimWalletManager/Account methods WDK doesn't call in the pot flow
// (quoteTransfer, getAccountByPath, getFeeRates, toReadOnlyAccount, dispose
// guards), the invite decode/format edges, the solana-engine pre-flight guard,
// and the REAL WDK policy engine's token/amount edge conditions.

import test from 'brittle'
import z32 from 'z32'
import b4a from 'b4a'
import SimWalletManager, { SimWalletAccount } from '../src/wallet/sim-wallet.js'
import { SimLedger, USDT } from '../src/wallet/sim-ledger.js'
import { createTrebleWallet } from '../src/wallet/index.js'
import { encodeInvite, decodeInvite, shortKey } from '../src/p2p/invite.js'
import { toMicro } from '../src/core/money.js'

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// ── p2p/invite.js ───────────────────────────────────────────────────────────

test('invite: decode rejects non-strings, non-Treble strings and wrong-length keys', t => {
  t.exception(() => decodeInvite(42), /not a Treble invite/)
  t.exception(() => decodeInvite('pear1abc'), /not a Treble invite/)
  const twoBytes = 'treble1' + z32.encode(b4a.from('0011', 'hex'))
  t.exception(() => decodeInvite(twoBytes), /must be 32 bytes/)
})

test('invite: encode/decode round-trips a 32-byte key', t => {
  const key = b4a.from('ab'.repeat(32), 'hex')
  t.alike(decodeInvite(encodeInvite(key)), key)
})

test('invite: shortKey formats a hex string or a buffer', t => {
  const hex = 'ab'.repeat(32)
  t.is(shortKey(hex), 'abababab…abab')
  t.is(shortKey(b4a.from(hex, 'hex')), 'abababab…abab')
  t.is(shortKey(hex, 4), 'abab…abab')
})

// ── wallet/sim-wallet.js: the SimWalletManager / account surface ─────────────

test('sim-wallet: SimWalletAccount is a real @tetherto/wdk-wallet account', t => {
  const account = new SimWalletAccount({ index: 3, seed: b4a.from('00'.repeat(32), 'hex'), ledger: new SimLedger() })
  t.is(account.index, 3)
  t.is(account.path, "m/7342'/0'/3'")
})

test('sim-wallet: manager requires a ledger (L93)', t => {
  t.exception(() => new SimWalletManager(SEED, {}), /requires \{ ledger/)
})

test('sim-wallet: manager resolves accounts by index and by path (L106-109)', async t => {
  const manager = new SimWalletManager(SEED, { ledger: new SimLedger() })
  const a0 = await manager.getAccount(0)
  const byPath = await manager.getAccountByPath("m/7342'/0'/0'")
  t.is(a0, byPath, 'same cached account for index 0 and its path')
  const a2 = await manager.getAccountByPath("m/7342'/0'/2'")
  t.is(a2.index, 2)
  await t.exception(manager.getAccountByPath('m/44/0/0'), /unsupported sim derivation path/)
})

test('sim-wallet: manager reports zero fee rates (L112-113)', async t => {
  const manager = new SimWalletManager(SEED, { ledger: new SimLedger() })
  const rates = await manager.getFeeRates()
  t.is(rates.normal, 0n)
  t.is(rates.fast, 0n)
})

test('sim-wallet: account quoteTransfer is feeless like a gasless USD₮ flow (L70-71)', async t => {
  const manager = new SimWalletManager(SEED, { ledger: new SimLedger() })
  const account = await manager.getAccount(0)
  t.alike(await account.quoteTransfer(), { fee: 0 })
})

test('sim-wallet: toReadOnlyAccount exposes address + balance, guarding the token (L79-81)', async t => {
  const ledger = new SimLedger()
  const manager = new SimWalletManager(SEED, { ledger })
  const account = await manager.getAccount(0)
  const address = await account.getAddress()
  ledger.faucet(address, toMicro('7'))
  const ro = await account.toReadOnlyAccount()
  t.is(await ro.getAddress(), address)
  t.is(await ro.getBalance(), toMicro('7'))
  t.is(await ro.getBalance(USDT), toMicro('7'))
  await t.exception(ro.getBalance('BTC'), /only tracks USD₮/)
})

test('sim-wallet: account getBalance rejects a non-USD₮ token (L47)', async t => {
  const manager = new SimWalletManager(SEED, { ledger: new SimLedger() })
  const account = await manager.getAccount(0)
  await t.exception(account.getBalance('BTC'), /only tracks USD₮/)
})

test('sim-wallet: transfer guards the token, and a disposed account refuses to act (L38/52/62/63)', async t => {
  const ledger = new SimLedger()
  const manager = new SimWalletManager(SEED, { ledger })
  const account = await manager.getAccount(0)
  const address = await account.getAddress()
  ledger.faucet(address, toMicro('10'))

  await t.exception(account.transfer({ token: 'BTC', recipient: 'x', amount: 1 }), /only settles USD₮/) // L63
  t.ok(account.keyPair.privateKey, 'a live account exposes its private key') // L38 (not disposed)

  account.dispose()
  t.is(account.keyPair.privateKey, null, 'a disposed account hides its private key') // L38 (disposed)
  await t.exception(account.sign('x'), /account disposed/) // L52
  await t.exception(account.transfer({ token: USDT, recipient: 'x', amount: 1 }), /account disposed/) // L62
})

// ── wallet/index.js: solana pre-flight + the REAL WDK policy edge conditions ─

test('wallet: the solana engine fails loudly without the optional module (L33-41)', async t => {
  await t.exception(createTrebleWallet({ engine: 'solana', seedPhrase: SEED }), /needs @tetherto\/wdk-wallet-solana/)
})

test('wallet: the agent policy engine evaluates token/amount edge cases (withinCaps L53-56)', async t => {
  const ledger = new SimLedger()
  const wallet = await createTrebleWallet({ seedPhrase: SEED, engine: 'sim', ledger, agentPolicy: { perTxCap: toMicro('20'), sessionCap: toMicro('25') } })
  t.teardown(() => wallet.dispose())
  ledger.faucet(wallet.address, toMicro('100'))
  const sim = params => wallet.account.simulate.transfer({ recipient: 'r', __address: wallet.address, ...params })

  t.is((await sim({ amount: toMicro('5') })).decision, 'ALLOW', 'no token ⇒ USD₮ default, within cap (L54)')
  t.is((await sim({ token: 'BTC', amount: toMicro('5') })).decision, 'DENY', 'a foreign token is refused (L55)')
  t.is((await sim({ token: USDT })).decision, 'DENY', 'no amount ⇒ unbounded ⇒ over cap (L53)')
  t.is((await sim({ token: USDT, amount: -5 })).decision, 'DENY', 'a non-positive amount is refused (L56)')
})
