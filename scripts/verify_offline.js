// "The agent thinks on-device" verifier (workflow-mandated).
//
// Blocks ALL outbound networking at runtime (dns + net + fetch tripwires),
// then runs the ENTIRE agent flow — seat grant, WDK Transaction-Policy
// pre-flight, pick formation, bond, stake, pick on the ledger — plus a full
// human+agent pot through consensus and settlement. If anything dials out,
// this script fails loudly.
//
// Brain note: heuristic brain is used here because CI machines have no local
// model; it is DISCLOSED output. With a local GGUF (TREBLE_QVAC_MODEL=path)
// the same script proves the QVAC LLM reasons fully offline too.

import fs from 'fs'
import os from 'os'
import path from 'path'
import net from 'net'
import dns from 'dns'
import { fileURLToPath } from 'url'

// ── network kill-switch ───────────────────────────────────────────────────
let dialAttempts = 0
const forbid = what => { dialAttempts++; throw new Error(`OFFLINE VIOLATION: attempted ${what}`) }
net.Socket.prototype.connect = function () { forbid('net.Socket.connect') }
net.createConnection = () => forbid('net.createConnection')
dns.lookup = () => forbid('dns.lookup')
dns.resolve = () => forbid('dns.resolve')
globalThis.fetch = () => forbid('fetch()')

const { TreblePot } = await import('../src/p2p/pot.js')
const opsModule = await import('../src/core/ops.js')
const ops = opsModule
const { createTrebleWallet } = await import('../src/wallet/index.js')
const { SimLedger } = await import('../src/wallet/sim-ledger.js')
const { AgentSeat } = await import('../src/agent/seat.js')
const { getStrategy } = await import('../src/agent/strategies.js')
const { settlementPlan, legsFor } = await import('../src/core/settlement.js')
const { toMicro, fromMicro } = await import('../src/core/money.js')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const matches = JSON.parse(fs.readFileSync(path.join(HERE, '../data/fixtures/matches.json'), 'utf8'))
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'treble-offline-'))

console.log('The Treble — offline verifier (network syscalls are booby-trapped)\n')

const ledger = new SimLedger()
const kickoff = Date.now() + 3_600_000
const buyIn = toMicro('20')

const human = await TreblePot.create({
  storage: tmp(),
  swarm: false, // Hyperswarm would (rightly) try to dial the DHT — discovery is the ONE thing that needs a network
  pot: { name: 'Offline Pot', matchId: 'wc2026-bra-arg', home: 'Brazil', away: 'Argentina', kickoff, buyIn }
})
const agentPot = await TreblePot.join({ storage: tmp(), invite: human.invite, swarm: false })
const s1 = human.store.replicate(true); const s2 = agentPot.store.replicate(false)
s1.pipe(s2).pipe(s1); s1.on('error', () => {}); s2.on('error', () => {})
console.log('① pot + replication up with zero sockets (local streams)')

const humanWallet = await createTrebleWallet({ engine: 'sim', ledger })
const agentWallet = await createTrebleWallet({
  engine: 'sim',
  ledger,
  agentPolicy: { perTxCap: buyIn, sessionCap: toMicro('25') }
})
ledger.faucet(humanWallet.address, toMicro('100'))
ledger.faucet(agentWallet.address, toMicro('100'))
console.log('② real @tetherto/wdk wallets + Transaction Policy engine initialized — offline')

await human.approveSeat({ writer: agentPot.writerKey, role: 'agent', label: 'The Gaffer' })
await human.append(ops.join({ label: 'Human', wallet: humanWallet.address }))
const humanReceipt = await humanWallet.stakeBond({ potKey: human.key.toString('hex'), amount: buyIn })
await human.append(ops.stake({ amount: buyIn, engine: 'sim', txHash: humanReceipt.hash }))
await human.append(ops.pick({ home: 0, away: 0 }))

const seat = new AgentSeat({
  pot: agentPot,
  wallet: agentWallet,
  match: matches['wc2026-bra-arg'],
  strategy: getStrategy('gaffer'),
  brain: process.env.TREBLE_QVAC_MODEL ? 'qvac' : 'heuristic'
})
const decision = await seat.play()
console.log(`③ agent reasoned and staked OFFLINE — [brain: ${decision.brain}] "${decision.rationale}"`)

const sync = async () => { await human.update(); await agentPot.update() }
for (let i = 0; i < 200; i++) {
  await sync()
  if ((await human.state()).picks[agentPot.writerKey]) break
  await new Promise(resolve => setTimeout(resolve, 25))
}

await human.append(ops.lock({ ts: kickoff + 1000 }))
await human.append(ops.vote({ home: decision.home, away: decision.away, ts: kickoff + 2000 }))
let finalState = null
for (let i = 0; i < 200 && !finalState; i++) {
  await sync()
  const s = await human.state()
  if (s.splits) finalState = s
  else await new Promise(resolve => setTimeout(resolve, 25))
}
if (!finalState) throw new Error('finality never reached')
console.log(`④ consensus + deterministic split computed offline (machine ${finalState.splits.winners.includes(agentPot.writerKey) ? 'WON' : 'lost'})`)

const plan = settlementPlan(finalState)
await humanWallet.executeSettlementLegs({ potKey: human.key.toString('hex'), legs: legsFor(plan, human.writerKey), resolveAddress: id => finalState.members[id].wallet })
await seat.settleIfFinal()
const paid = Object.values(finalState.splits.payouts).reduce((a, b) => a + b, 0)
console.log(`⑤ settlement executed offline — Σ ${fromMicro(paid)} == ${fromMicro(finalState.splits.total)} USD₮, agent wallet now ${fromMicro(ledger.balance(agentWallet.address))} USD₮`)

humanWallet.dispose()
agentWallet.dispose()
await human.close()
await agentPot.close()

if (dialAttempts > 0) {
  console.error(`\nverify:offline FAILED — ${dialAttempts} network dial attempt(s)`)
  process.exit(1)
}
console.log('\nverify:offline ✓ — reasoning, policy, staking, consensus and settlement all ran with networking disabled')
console.log('  (only Hyperswarm peer DISCOVERY needs a network; with a local GGUF set TREBLE_QVAC_MODEL to prove the LLM path offline too)')
process.exit(0)
