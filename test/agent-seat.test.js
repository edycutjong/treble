// The seam, end-to-end: an AI pundit with its own WDK wallet joins a real
// Autobase pot next to humans, pre-flights its Transaction Policy, stakes
// with a real (sim-engine) receipt, and honours the settlement plan.

import test from 'brittle'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { TreblePot } from '../src/p2p/pot.js'
import { AgentSeat } from '../src/agent/seat.js'
import { STRATEGIES } from '../src/agent/strategies.js'
import { createTrebleWallet } from '../src/wallet/index.js'
import { SimLedger } from '../src/wallet/sim-ledger.js'
import * as ops from '../src/core/ops.js'
import { formPickHeuristic } from '../src/agent/brains/heuristic.js'
import { toMicro } from '../src/core/money.js'

const matches = JSON.parse(fs.readFileSync(new URL('../data/fixtures/matches.json', import.meta.url), 'utf8'))
const BUY_IN = toMicro('20')

function tmpdir (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'treble-seat-'))
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function link (t, a, b) {
  const sa = a.store.replicate(true)
  const sb = b.store.replicate(false)
  sa.pipe(sb).pipe(sa)
  sa.on('error', () => {})
  sb.on('error', () => {})
  t.teardown(() => { sa.destroy(); sb.destroy() })
}

async function until (fn, what, tries = 200) {
  for (let i = 0; i < tries; i++) {
    const value = await fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function setup (t, { buyIn = BUY_IN, agentPolicy = { perTxCap: toMicro('20'), sessionCap: toMicro('25') } } = {}) {
  const ledger = new SimLedger()
  // kickoff genuinely in the future: the seat stamps ops with Date.now()
  const kickoff = Date.now() + 3_600_000

  const creator = await TreblePot.create({
    storage: tmpdir(t),
    swarm: false,
    pot: {
      name: 'Seam Test Pot',
      matchId: 'wc2026-bra-arg',
      home: 'Brazil',
      away: 'Argentina',
      kickoff,
      buyIn
    }
  })
  const agentPot = await TreblePot.join({ storage: tmpdir(t), invite: creator.invite, swarm: false })
  t.teardown(() => creator.close())
  t.teardown(() => agentPot.close())
  link(t, creator, agentPot)

  const anaWallet = await createTrebleWallet({ engine: 'sim', ledger })
  const agentWallet = await createTrebleWallet({ engine: 'sim', ledger, agentPolicy })
  t.teardown(() => anaWallet.dispose())
  t.teardown(() => agentWallet.dispose())
  ledger.faucet(anaWallet.address, toMicro('100'))
  ledger.faucet(agentWallet.address, toMicro('100'))

  const seat = new AgentSeat({
    pot: agentPot,
    wallet: agentWallet,
    match: matches['wc2026-bra-arg'],
    strategy: STRATEGIES.gaffer,
    brain: 'heuristic'
  })

  // grant the agent seat as a HUMAN would, via the request/approve flow
  await creator.approveSeat({ writer: agentPot.writerKey, role: 'agent', label: 'The Gaffer' })

  return { ledger, creator, agentPot, anaWallet, agentWallet, seat, kickoff }
}

test('seat: agent joins, pre-flights policy, stakes with a real receipt and picks', async t => {
  const { ledger, creator, agentPot, agentWallet, seat } = await setup(t)

  const statuses = []
  seat.on('status', s => statuses.push(s))
  let preflight = null
  seat.on('preflight', p => { preflight = p })

  const decision = await seat.play()
  t.ok(decision, 'agent played')
  t.is(decision.brain, 'heuristic')
  t.is(preflight.decision, 'ALLOW', 'policy pre-flight ran against the real WDK engine')

  const state = await until(async () => {
    await creator.update()
    await agentPot.update()
    const s = await creator.state()
    return s.picks[seat.id] ? s : null
  }, 'agent pick to replicate')

  t.is(state.members[seat.id].role, 'agent', 'seated as agent — the grant decides')
  t.is(state.members[seat.id].wallet, agentWallet.address, 'self-custodial wallet on record')
  t.is(state.stakes[seat.id].amount, BUY_IN)
  t.ok(state.stakes[seat.id].txHash.startsWith('sim0x'), 'stake references the settlement receipt')
  t.is(state.picks[seat.id].note, decision.rationale, 'rationale rides the ledger')

  const bond = await agentWallet.getBondAccount(creator.key.toString('hex'))
  t.is(ledger.balance(bond.address), BUY_IN, 'buy-in ring-fenced in the agent own bond account')
  t.ok(statuses.some(s => s.includes('joined the pot')), 'narrates its moves')
})

test('seat: agent DECLINES a pot whose buy-in exceeds its policy cap', async t => {
  const { ledger, creator, agentPot, agentWallet, seat } = await setup(t, {
    buyIn: toMicro('50'),
    agentPolicy: { perTxCap: toMicro('20'), sessionCap: toMicro('25') }
  })

  let declined = null
  seat.on('declined', d => { declined = d })
  const decision = await seat.play()

  t.is(decision, null, 'no decision — it never got past its own allowance')
  t.is(declined.preflight.decision, 'DENY')
  t.is(ledger.spent(agentWallet.address), 0, 'not a micro moved')

  const state = await until(async () => {
    await creator.update()
    await agentPot.update()
    const s = await creator.state()
    return s.notes.length > 0 ? s : null
  }, 'decline note to replicate')
  t.ok(state.notes[0].text.includes('exceeds my Transaction Policy cap'), 'the decline is on the shared ledger')
  t.absent(state.stakes[seat.id], 'no stake recorded')
})

test('seat: full match — agent wins the pot and the humans pay it', async t => {
  const { ledger, creator, agentPot, anaWallet, agentWallet, seat, kickoff } = await setup(t)

  // the heuristic is deterministic — compute the machine's pick up front so
  // Ana can pick differently and "reality" can side with the machine
  const expected = formPickHeuristic({ match: matches['wc2026-bra-arg'], strategy: STRATEGIES.gaffer })
  const anaPick = { home: expected.home === 0 ? 4 : 0, away: expected.away === 0 ? 4 : 0 }

  await creator.append(ops.join({ label: 'Ana', wallet: anaWallet.address }))
  const anaStake = await anaWallet.stakeBond({ potKey: creator.key.toString('hex'), amount: BUY_IN })
  await creator.append(ops.stake({ amount: BUY_IN, engine: 'sim', txHash: anaStake.hash }))
  await creator.append(ops.pick(anaPick))

  const played = await seat.play()
  t.alike({ home: played.home, away: played.away }, { home: expected.home, away: expected.away }, 'seat used the deterministic brain')

  // real pots converge long before kickoff; give this one the same guarantee
  // so the lock cannot causally fork ahead of the agent's pick
  await until(async () => {
    await creator.update()
    await agentPot.update()
    const s = await creator.state()
    return s.picks[seat.id] ? s : null
  }, 'agent ops to replicate before kickoff')

  await creator.append(ops.lock({ ts: kickoff + 60_000 }))
  await creator.append(ops.vote({ home: expected.home, away: expected.away, ts: kickoff + 61_000 }))

  const finalState = await until(async () => {
    await creator.update()
    await agentPot.update()
    const s = await creator.state()
    return s.splits ? s : null
  }, 'finality (1 staked human ⇒ quorum 1)')

  t.alike(finalState.splits.winners, [seat.id], 'the machine called it, the human did not')
  t.is(finalState.splits.payouts[seat.id], BUY_IN * 2)

  // Ana honours her leg of the plan; the agent honours its own
  const { settlementPlan, legsFor } = await import('../src/core/settlement.js')
  const plan = settlementPlan(finalState)
  const anaReceipts = await anaWallet.executeSettlementLegs({
    potKey: creator.key.toString('hex'),
    legs: legsFor(plan, creator.writerKey),
    resolveAddress: id => finalState.members[id].wallet
  })
  await creator.append(ops.settle({ engine: 'sim', txHash: anaReceipts.at(-1).hash }))

  const result = await until(() => seat.settleIfFinal(), 'agent settlement')
  t.ok(result.won, 'the agent knows it won')

  t.is(ledger.balance(agentWallet.address), toMicro('100') - BUY_IN + BUY_IN * 2, 'agent main wallet: −20 stake +40 payout')
  const agentBond = await agentWallet.getBondAccount(creator.key.toString('hex'))
  t.is(ledger.balance(agentBond.address), 0, 'agent bond fully released')
  t.is(ledger.balance(anaWallet.address), toMicro('100') - BUY_IN, 'Ana paid her stake, nothing else')
  t.is(ledger.totalSupply(), toMicro('200'), 'Σ conserved across the whole match')

  const settledState = await until(async () => {
    await creator.update()
    await agentPot.update()
    const s = await creator.state()
    return Object.keys(s.settlements).length === 2 ? s : null
  }, 'both settle ops on the ledger')
  t.ok(settledState.settlements[seat.id].txHash.startsWith('sim0x'))
})

test('seat: agent cannot vote even after playing (no-oracle, over the wire)', async t => {
  const { creator, agentPot, seat, kickoff } = await setup(t)
  await creator.append(ops.join({ label: 'Ana', wallet: 'ana-addr' })) // only members may lock
  await seat.play()
  await until(async () => {
    await creator.update()
    await agentPot.update()
    const s = await creator.state()
    return s.picks[seat.id] ? s : null
  }, 'agent ops to replicate before kickoff')
  await creator.append(ops.lock({ ts: kickoff + 60_000 }))

  // the agent must SEE the lock before voting, so the rejection reason is
  // unambiguously about authority, not ordering
  await until(async () => {
    await creator.update()
    await agentPot.update()
    const s = await agentPot.state()
    return s.locked ? s : null
  }, 'lock to reach the agent')
  await agentPot.append(ops.vote({ home: 9, away: 0, ts: kickoff + 61_000 }))
  const state = await until(async () => {
    await creator.update()
    await agentPot.update()
    const s = await creator.state()
    const voteEvents = (await creator.events()).filter(e => e.type === 'vote' && e.from === seat.id)
    return voteEvents.length > 0 ? { s, voteEvents } : null
  }, 'agent vote to be processed')

  t.absent(state.voteEvents[0].ok, 'vote rejected by every honest peer')
  t.is(state.voteEvents[0].reason, 'agent-has-no-result-authority')
  t.is(state.s.result, null)
})
