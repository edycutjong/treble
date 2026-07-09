// Wallet facade — one call to stand up a self-custodial participant wallet.
//
// engine 'sim'    → local deterministic ledger (disclosed; default for demo/CI)
// engine 'solana' → @tetherto/wdk-wallet-solana on devnet (real testnet path;
//                   requires the module installed and a funded account)
//
// For AGENT wallets a WDK Transaction Policy is registered: a single ALLOW
// rule for bounded USD₮ transfers. Everything else on the account is refused
// by WDK's default-deny engine — the pundit can stake, and that is all it
// can do.

import WDK from '@tetherto/wdk'
import SimWalletManager from './sim-wallet.js'
import { USDT } from './sim-ledger.js'
import { fmtUsdt } from '../core/money.js'

export const WALLET_NAME = 'treble'

export async function createTrebleWallet ({
  seedPhrase,
  engine = 'sim',
  ledger = null,
  accountIndex = 0,
  agentPolicy = null // { perTxCap, sessionCap } in micro-USD₮ — agents only
}) {
  const seed = seedPhrase ?? WDK.getRandomSeedPhrase()
  const wdk = new WDK(seed)

  if (engine === 'sim') {
    if (!ledger) throw new Error("engine 'sim' requires a SimLedger instance")
    wdk.registerWallet(WALLET_NAME, SimWalletManager, { ledger })
  } else if (engine === 'solana') {
    let WalletManagerSolana
    try {
      /* c8 ignore next -- import-success arm only when the optional @tetherto/wdk-wallet-solana is installed; the not-installed failure path (catch) is covered */
      ({ default: WalletManagerSolana } = await import('@tetherto/wdk-wallet-solana'))
    } catch {
      throw new Error(
        'engine "solana" needs @tetherto/wdk-wallet-solana — install it and fund the devnet account, ' +
        'or run with the disclosed sim engine (--engine sim)'
      )
    }
    /* c8 ignore start -- real Solana WDK module: only runs when the optional @tetherto/wdk-wallet-solana dep is installed + a devnet account funded (not in CI/tests) */
    wdk.registerWallet(WALLET_NAME, WalletManagerSolana, {
      rpcUrl: process.env.TREBLE_SOLANA_RPC ?? 'https://api.devnet.solana.com',
      commitment: 'confirmed'
    })
    /* c8 ignore stop */
  } else {
    throw new Error(`unknown wallet engine: ${engine}`)
  }

  if (agentPolicy) {
    const { perTxCap, sessionCap } = agentPolicy
    const withinCaps = params => {
      const amount = Number(params?.amount ?? Number.MAX_SAFE_INTEGER)
      const token = params?.token ?? USDT
      if (token !== USDT) return false
      if (!Number.isSafeInteger(amount) || amount <= 0) return false
      if (amount > perTxCap) return false
      if (engine === 'sim' && ledger) {
        // cumulative cap reads EXECUTED transfers from the ledger, so
        // simulations never consume budget
        return ledger.spent(params.__address) + amount <= sessionCap
      }
      /* c8 ignore next -- solana-engine session-cap fallback: no local ledger to read executed spend; the disclosed sim engine always takes the ledger path above (line 58) */
      return amount <= sessionCap
    }
    wdk.registerPolicy({
      id: 'treble-agent-cap',
      name: `AI pundit spend cap (${fmtUsdt(perTxCap)}/stake, ${fmtUsdt(sessionCap)}/session)`,
      scope: 'project',
      wallet: WALLET_NAME,
      rules: [{
        name: 'allow-bounded-usdt-stake',
        operation: 'transfer',
        action: 'ALLOW',
        conditions: [({ params }) => withinCaps(params)]
      }, {
        // explicit DENY so a blocked stake reports WHICH policy refused it
        name: 'deny-over-cap-stake',
        operation: 'transfer',
        action: 'DENY',
        conditions: [({ params }) => !withinCaps(params)]
      }]
    })
  }

  const account = await wdk.getAccount(WALLET_NAME, accountIndex)
  const address = await account.getAddress()

  const bondAccounts = new Map()
  async function getBondAccount (potKeyHex) {
    if (!bondAccounts.has(potKeyHex)) {
      const bondAccount = await wdk.getAccount(WALLET_NAME, bondIndexFor(potKeyHex))
      bondAccounts.set(potKeyHex, { account: bondAccount, address: await bondAccount.getAddress() })
    }
    return bondAccounts.get(potKeyHex)
  }

  return {
    wdk,
    account,
    address,
    engine,
    seedPhrase: seed,
    policy: agentPolicy,
    getBondAccount,
    // Ring-fence the buy-in in the participant's OWN pot-bond sub-account.
    // Self-custody is preserved: the bond key is derived from the same seed.
    async stakeBond ({ potKey, amount }) {
      const bond = await getBondAccount(potKey)
      const receipt = await account.transfer({ token: USDT, recipient: bond.address, amount, __address: address })
      return { ...receipt, bondAddress: bond.address }
    },
    async simulateStake ({ potKey, amount }) {
      const bond = await getBondAccount(potKey)
      return account.simulate.transfer({ token: USDT, recipient: bond.address, amount, __address: address })
    },
    // Execute my legs of the deterministic settlement plan (winners release
    // their own bond; losers pay winners) — every leg is a policy-governed
    // transfer with its own receipt.
    async executeSettlementLegs ({ potKey, legs, resolveAddress }) {
      const bond = await getBondAccount(potKey)
      const receipts = []
      for (const leg of legs) {
        const recipient = leg.kind === 'release' ? address : resolveAddress(leg.to)
        const receipt = await bond.account.transfer({ token: USDT, recipient, amount: leg.amount, __address: bond.address })
        receipts.push({ leg, hash: receipt.hash })
      }
      return receipts
    },
    dispose () {
      wdk.dispose()
    }
  }
}

// Deterministic bond-account index per pot (1…997 — index 0 is the main account).
export function bondIndexFor (potKeyHex) {
  let acc = 0
  for (let i = 0; i < potKeyHex.length; i++) {
    acc = (acc * 31 + potKeyHex.charCodeAt(i)) >>> 0
  }
  return 1 + (acc % 997)
}
