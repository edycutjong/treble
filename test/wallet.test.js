// The wallet layer — including the REAL @tetherto/wdk policy engine
// enforcing the AI pundit's spend cap (PolicyViolationError and all).

import test from 'brittle'
import WDK, { PolicyViolationError } from '@tetherto/wdk'
import { SimLedger, USDT } from '../src/wallet/sim-ledger.js'
import SimWalletManager from '../src/wallet/sim-wallet.js'
import { createTrebleWallet, bondIndexFor, WALLET_NAME } from '../src/wallet/index.js'
import { toMicro } from '../src/core/money.js'

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// ── SimLedger ─────────────────────────────────────────────────────────────

test('ledger: faucet, balance and transfer conserve value', t => {
  const ledger = new SimLedger()
  ledger.faucet('alice', toMicro('100'))
  t.is(ledger.balance('alice'), toMicro('100'))
  const { hash, fee } = ledger.transfer({ from: 'alice', to: 'pot', amount: toMicro('20') })
  t.ok(hash.startsWith('sim0x'))
  t.is(fee, 0)
  t.is(ledger.balance('alice'), toMicro('80'))
  t.is(ledger.balance('pot'), toMicro('20'))
  t.is(ledger.totalSupply(), toMicro('100'), 'transfers never mint or burn')
})

test('ledger: overdraft and zero transfers are refused', t => {
  const ledger = new SimLedger()
  ledger.faucet('alice', 10)
  t.exception(() => ledger.transfer({ from: 'alice', to: 'bob', amount: 11 }), /insufficient funds/)
  t.exception(() => ledger.transfer({ from: 'alice', to: 'bob', amount: 0 }), /positive/)
  t.is(ledger.balance('alice'), 10, 'failed transfers change nothing')
})

test('ledger: spent() tracks executed outgoing transfers only', t => {
  const ledger = new SimLedger()
  ledger.faucet('agent', toMicro('10'))
  ledger.transfer({ from: 'agent', to: 'pot', amount: toMicro('2') })
  ledger.transfer({ from: 'agent', to: 'pot', amount: toMicro('3') })
  ledger.faucet('agent', toMicro('1')) // incoming — not spend
  t.is(ledger.spent('agent'), toMicro('5'))
  t.is(ledger.spent('nobody'), 0)
})

test('ledger: every settlement gets a unique hash and history is queryable', t => {
  const ledger = new SimLedger()
  ledger.faucet('a', 100)
  const h1 = ledger.transfer({ from: 'a', to: 'b', amount: 1 }).hash
  const h2 = ledger.transfer({ from: 'a', to: 'b', amount: 1 }).hash
  t.not(h1, h2, 'nonce differentiates identical transfers')
  t.is(ledger.history('b').filter(e => e.kind === 'transfer').length, 2)
  t.is(ledger.history().length, 3)
})

// ── SimWalletManager inside real WDK ─────────────────────────────────────

test('wdk: sim manager registers into the real WDK pipeline', async t => {
  const ledger = new SimLedger()
  const wdk = new WDK(SEED).registerWallet(WALLET_NAME, SimWalletManager, { ledger })
  const account = await wdk.getAccount(WALLET_NAME, 0)
  const address = await account.getAddress()
  t.ok(address.startsWith('sim1'))
  t.is(account.index, 0)
  t.is(account.path, "m/7342'/0'/0'")
  wdk.dispose()
})

test('wdk: addresses are deterministic per seed and index', async t => {
  const ledgerA = new SimLedger()
  const ledgerB = new SimLedger()
  const a = new WDK(SEED).registerWallet(WALLET_NAME, SimWalletManager, { ledger: ledgerA })
  const b = new WDK(SEED).registerWallet(WALLET_NAME, SimWalletManager, { ledger: ledgerB })
  const addrA0 = await (await a.getAccount(WALLET_NAME, 0)).getAddress()
  const addrB0 = await (await b.getAccount(WALLET_NAME, 0)).getAddress()
  const addrA1 = await (await a.getAccount(WALLET_NAME, 1)).getAddress()
  t.is(addrA0, addrB0, 'same seed+index ⇒ same address')
  t.not(addrA0, addrA1, 'different index ⇒ different address')
  a.dispose()
  b.dispose()
})

test('wdk: transfer settles on the ledger with a receipt', async t => {
  const ledger = new SimLedger()
  const wdk = new WDK(SEED).registerWallet(WALLET_NAME, SimWalletManager, { ledger })
  const account = await wdk.getAccount(WALLET_NAME, 0)
  const address = await account.getAddress()
  ledger.faucet(address, toMicro('50'))
  const { hash, fee } = await account.transfer({ token: USDT, recipient: 'pot-addr', amount: toMicro('20') })
  t.ok(hash.startsWith('sim0x'))
  t.is(fee, 0)
  t.is(ledger.balance('pot-addr'), toMicro('20'))
  t.is(await account.getBalance(), toMicro('30'))
  wdk.dispose()
})

test('wdk: sign/verify round-trips on the account keypair', async t => {
  const ledger = new SimLedger()
  const wdk = new WDK(SEED).registerWallet(WALLET_NAME, SimWalletManager, { ledger })
  const account = await wdk.getAccount(WALLET_NAME, 0)
  const signature = await account.sign('I picked 2-1 before kickoff')
  t.ok(await account.verify('I picked 2-1 before kickoff', signature))
  t.absent(await account.verify('I picked 9-9 before kickoff', signature))
  wdk.dispose()
})

// ── facade + REAL policy engine ───────────────────────────────────────────

const POT_KEY = 'ab'.repeat(32)

test('wallet: human wallet is ungoverned and bonds freely', async t => {
  const ledger = new SimLedger()
  const wallet = await createTrebleWallet({ seedPhrase: SEED, engine: 'sim', ledger })
  ledger.faucet(wallet.address, toMicro('100'))
  const { hash, bondAddress } = await wallet.stakeBond({ potKey: POT_KEY, amount: toMicro('60') })
  t.ok(hash.startsWith('sim0x'), 'no policy, no cap — a human ring-fences their own money')
  t.is(ledger.balance(bondAddress), toMicro('60'))
  t.not(bondAddress, wallet.address, 'bond lives on a separate self-custodial sub-account')
  wallet.dispose()
})

test('wallet: bond index is deterministic per pot and in range', t => {
  t.is(bondIndexFor(POT_KEY), bondIndexFor(POT_KEY))
  t.not(bondIndexFor(POT_KEY), bondIndexFor('cd'.repeat(32)))
  for (const key of [POT_KEY, 'cd'.repeat(32), 'ef'.repeat(32)]) {
    const index = bondIndexFor(key)
    t.ok(index >= 1 && index <= 998, `index ${index} in bond range`)
  }
})

test('wallet: agent stake within cap is ALLOWED by the WDK policy engine', async t => {
  const ledger = new SimLedger()
  const wallet = await createTrebleWallet({
    seedPhrase: SEED,
    engine: 'sim',
    ledger,
    agentPolicy: { perTxCap: toMicro('20'), sessionCap: toMicro('25') }
  })
  ledger.faucet(wallet.address, toMicro('100'))
  const { hash, bondAddress } = await wallet.stakeBond({ potKey: POT_KEY, amount: toMicro('20') })
  t.ok(hash.startsWith('sim0x'))
  t.is(ledger.balance(bondAddress), toMicro('20'))
  wallet.dispose()
})

test('wallet: agent stake OVER the per-tx cap throws PolicyViolationError', async t => {
  const ledger = new SimLedger()
  const wallet = await createTrebleWallet({
    seedPhrase: SEED,
    engine: 'sim',
    ledger,
    agentPolicy: { perTxCap: toMicro('20'), sessionCap: toMicro('100') }
  })
  ledger.faucet(wallet.address, toMicro('100'))
  try {
    await wallet.stakeBond({ potKey: POT_KEY, amount: toMicro('21') })
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err instanceof PolicyViolationError, 'the REAL @tetherto/wdk error type')
    t.is(err.policyId, 'treble-agent-cap')
    t.is(err.ruleName, 'deny-over-cap-stake')
  }
  t.is(ledger.spent(wallet.address), 0, 'no money moved')
  wallet.dispose()
})

test('wallet: cumulative session cap counts executed stakes', async t => {
  const ledger = new SimLedger()
  const wallet = await createTrebleWallet({
    seedPhrase: SEED,
    engine: 'sim',
    ledger,
    agentPolicy: { perTxCap: toMicro('20'), sessionCap: toMicro('25') }
  })
  ledger.faucet(wallet.address, toMicro('100'))
  await wallet.stakeBond({ potKey: POT_KEY, amount: toMicro('20') })
  await t.exception(wallet.stakeBond({ potKey: 'cd'.repeat(32), amount: toMicro('6') }), /Policy/, '20 + 6 > 25 session cap')
  const ok = await wallet.stakeBond({ potKey: 'cd'.repeat(32), amount: toMicro('5') })
  t.ok(ok.hash, '20 + 5 fits the session cap exactly')
  wallet.dispose()
})

test('wallet: default-deny — the governed agent cannot even sign arbitrarily', async t => {
  const ledger = new SimLedger()
  const wallet = await createTrebleWallet({
    seedPhrase: SEED,
    engine: 'sim',
    ledger,
    agentPolicy: { perTxCap: toMicro('20'), sessionCap: toMicro('25') }
  })
  await t.exception(async () => wallet.account.sign('drain-authorization'), /Policy|policy/, 'sign is a governed operation with no ALLOW rule')
  wallet.dispose()
})

test('wallet: simulate evaluates the policy without spending', async t => {
  const ledger = new SimLedger()
  const wallet = await createTrebleWallet({
    seedPhrase: SEED,
    engine: 'sim',
    ledger,
    agentPolicy: { perTxCap: toMicro('20'), sessionCap: toMicro('25') }
  })
  ledger.faucet(wallet.address, toMicro('100'))
  const allow = await wallet.simulateStake({ potKey: POT_KEY, amount: toMicro('20') })
  t.is(allow.decision, 'ALLOW')
  const deny = await wallet.simulateStake({ potKey: POT_KEY, amount: toMicro('21') })
  t.is(deny.decision, 'DENY')
  t.is(ledger.spent(wallet.address), 0, 'simulation consumed no session budget')
  wallet.dispose()
})

test('wallet: settlement legs execute from the bond with per-leg receipts', async t => {
  const ledger = new SimLedger()
  const winner = await createTrebleWallet({ seedPhrase: SEED, engine: 'sim', ledger })
  const loser = await createTrebleWallet({ engine: 'sim', ledger })
  ledger.faucet(winner.address, toMicro('20'))
  ledger.faucet(loser.address, toMicro('20'))
  await winner.stakeBond({ potKey: POT_KEY, amount: toMicro('20') })
  await loser.stakeBond({ potKey: POT_KEY, amount: toMicro('20') })

  const winnerReceipts = await winner.executeSettlementLegs({
    potKey: POT_KEY,
    legs: [{ from: 'w', to: 'w', amount: toMicro('20'), kind: 'release' }],
    resolveAddress: () => { throw new Error('release never resolves an address') }
  })
  const loserReceipts = await loser.executeSettlementLegs({
    potKey: POT_KEY,
    legs: [{ from: 'l', to: 'w', amount: toMicro('20'), kind: 'payout' }],
    resolveAddress: () => winner.address
  })
  t.is(winnerReceipts.length, 1)
  t.ok(winnerReceipts[0].hash.startsWith('sim0x'))
  t.ok(loserReceipts[0].hash.startsWith('sim0x'))
  t.is(ledger.balance(winner.address), toMicro('40'), 'winner made whole: own release + loser payout')
  t.is(ledger.balance((await loser.getBondAccount(POT_KEY)).address), 0, 'loser bond emptied')
  winner.dispose()
  loser.dispose()
})

test('wallet: unknown engine and missing ledger fail loudly', async t => {
  await t.exception(createTrebleWallet({ engine: 'venmo' }), /unknown wallet engine/)
  await t.exception(createTrebleWallet({ engine: 'sim' }), /requires a SimLedger/)
})
