// Coverage for the AgentSeat's rejection/settlement paths that the happy-path
// seam suite doesn't reach: a ledger-rejected pick (stake stands), a
// ledger-rejected stake (bond auto-released), the agent LOSING and paying a
// human winner, and the defensive guards. The stake/pick-reject and defensive
// cases use a conforming in-process stub pot (the established injection pattern
// from the reference build) to hit races/guards deterministically — real
// Autobase pots are used wherever the branch is reachable without a race.

import test from 'brittle'
import fs from 'fs'
import os from 'os'
import path from 'path'
import b4a from 'b4a'
import { TreblePot } from '../src/p2p/pot.js'
import { AgentSeat } from '../src/agent/seat.js'
import { STRATEGIES } from '../src/agent/strategies.js'
import { createTrebleWallet } from '../src/wallet/index.js'
import { SimLedger } from '../src/wallet/sim-ledger.js'
import { formPickHeuristic } from '../src/agent/brains/heuristic.js'
import { settlementPlan, legsFor } from '../src/core/settlement.js'
import * as ops from '../src/core/ops.js'
import { toMicro } from '../src/core/money.js'

const matches = JSON.parse(fs.readFileSync(new URL('../data/fixtures/matches.json', import.meta.url), 'utf8'))
const braArg = matches['wc2026-bra-arg']
const BUY_IN = toMicro('20')
const AGENT_ID = 'dd'.repeat(32)

function tmpdir (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'treble-seatcov-'))
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

async function agentWalletWith (t, ledger, policy = { perTxCap: toMicro('20'), sessionCap: toMicro('25') }) {
  const wallet = await createTrebleWallet({ engine: 'sim', ledger, agentPolicy: policy })
  t.teardown(() => wallet.dispose())
  return wallet
}

// A minimal pot that satisfies the exact surface AgentSeat touches. Used only
// where the real Autobase path would need a wire-level race or a corrupt state.
class StubPot {
  constructor ({ state, results = {}, throwOn = [] } = {}) {
    this.writable = true
    this.key = b4a.from('ab'.repeat(32), 'hex')
    this.writerKey = AGENT_ID
    this._state = state
    this._results = results
    this._throwOn = throwOn
    this.notes = []
    this.appends = []
  }

  requestSeat () {}
  async waitWritable () {}
  async update () {}
  async state () { return this._state }
  async append (op) {
    if (this._throwOn.includes(op.type)) throw new Error(`append(${op.type}) blew up`)
    this.appends.push(op)
    if (op.type === 'note') this.notes.push(op.text)
    const r = this._results[op.type]
    return { state: this._state, event: r ?? { ok: true, type: op.type, ts: op.ts } }
  }
}

// ── real Autobase pots where the branch is reachable without a race ──────────

test('seat: a pick rejected at the ledger leaves the stake standing (L122-132)', async t => {
  // kickoff already in the past, but no structural lock op yet: applyStake has
  // no kickoff guard so the bond posts, while applyPick rejects a Date.now() ts
  const ledger = new SimLedger()
  const kickoff = Date.now() - 1000
  const creator = await TreblePot.create({ storage: tmpdir(t), swarm: false, pot: { name: 'Past', matchId: 'wc2026-bra-arg', home: 'Brazil', away: 'Argentina', kickoff, buyIn: BUY_IN } })
  const agentPot = await TreblePot.join({ storage: tmpdir(t), invite: creator.invite, swarm: false })
  t.teardown(() => creator.close())
  t.teardown(() => agentPot.close())
  link(t, creator, agentPot)

  const agentWallet = await agentWalletWith(t, ledger)
  ledger.faucet(agentWallet.address, toMicro('100'))
  await creator.approveSeat({ writer: agentPot.writerKey, role: 'agent', label: 'The Gaffer' })

  const seat = new AgentSeat({ pot: agentPot, wallet: agentWallet, match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  let pickRejected = null
  seat.on('pick-rejected', e => { pickRejected = e })
  const decision = await seat.play()

  t.ok(decision, 'it still returns its decision')
  t.is(decision.staked, true, 'the stake posted')
  t.is(decision.picked, false, 'but the pick was refused')
  t.is(pickRejected.reason, 'pot-locked-at-kickoff', 'and it announced why')
  const staked = await until(async () => {
    await creator.update(); await agentPot.update()
    const s = await creator.state()
    return s.stakes[seat.id] ? s : null
  }, 'the agent stake to replicate')
  t.absent(staked.picks[seat.id], 'no pick on the ledger — the stake stands alone per protocol')
})

test('seat: when the agent loses it pays the human winner (resolveAddress, L153-156/163)', async t => {
  const ledger = new SimLedger()
  const kickoff = Date.now() + 3_600_000
  const creator = await TreblePot.create({ storage: tmpdir(t), swarm: false, pot: { name: 'Loss', matchId: 'wc2026-bra-arg', home: 'Brazil', away: 'Argentina', kickoff, buyIn: BUY_IN } })
  const agentPot = await TreblePot.join({ storage: tmpdir(t), invite: creator.invite, swarm: false })
  t.teardown(() => creator.close())
  t.teardown(() => agentPot.close())
  link(t, creator, agentPot)

  const anaWallet = await createTrebleWallet({ engine: 'sim', ledger })
  t.teardown(() => anaWallet.dispose())
  const agentWallet = await agentWalletWith(t, ledger)
  ledger.faucet(anaWallet.address, toMicro('100'))
  ledger.faucet(agentWallet.address, toMicro('100'))
  await creator.approveSeat({ writer: agentPot.writerKey, role: 'agent', label: 'The Gaffer' })

  const seat = new AgentSeat({ pot: agentPot, wallet: agentWallet, match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  const expected = formPickHeuristic({ match: braArg, strategy: STRATEGIES.gaffer })
  // Ana picks a DIFFERENT score and reality (the vote) sides with Ana ⇒ agent loses
  const anaPick = { home: expected.home === 5 ? 0 : 5, away: expected.away }

  await creator.append(ops.join({ label: 'Ana', wallet: anaWallet.address }))
  const anaStake = await anaWallet.stakeBond({ potKey: creator.key.toString('hex'), amount: BUY_IN })
  await creator.append(ops.stake({ amount: BUY_IN, engine: 'sim', txHash: anaStake.hash }))
  await creator.append(ops.pick(anaPick))

  await seat.play()
  await until(async () => {
    await creator.update(); await agentPot.update()
    const s = await creator.state()
    return s.picks[seat.id] ? s : null
  }, 'agent ops to replicate before kickoff')

  await creator.append(ops.lock({ ts: kickoff + 60_000 }))
  await creator.append(ops.vote({ home: anaPick.home, away: anaPick.away, ts: kickoff + 61_000 }))

  const finalState = await until(async () => {
    await creator.update(); await agentPot.update()
    const s = await creator.state()
    return s.splits ? s : null
  }, 'finality')
  t.alike(finalState.splits.winners, [creator.writerKey], 'Ana called it, the machine did not')

  // Ana settles her winning legs first, then the agent honours its losing legs
  const anaReceipts = await anaWallet.executeSettlementLegs({
    potKey: creator.key.toString('hex'),
    legs: legsFor(settlementPlan(finalState), creator.writerKey),
    resolveAddress: id => finalState.members[id].wallet
  })
  await creator.append(ops.settle({ engine: 'sim', txHash: anaReceipts.at(-1).hash }))

  let settled = null
  seat.on('settled', e => { settled = e })
  const result = await until(() => seat.settleIfFinal(), 'agent settlement')
  t.absent(result.won, 'the agent knows it lost')
  t.is(settled.won, false)
  t.is(settled.payout, 0, 'zero payout ⇒ the ?? 0 fallback')
  t.is(ledger.balance(anaWallet.address), toMicro('100') + BUY_IN, 'Ana up a full buy-in')
  t.is(ledger.balance(agentWallet.address), toMicro('100') - BUY_IN, 'the agent down its stake')
  const bond = await agentWallet.getBondAccount(creator.key.toString('hex'))
  t.is(ledger.balance(bond.address), 0, 'agent bond emptied paying Ana')
})

// ── conforming stub pot for guard/race branches ──────────────────────────────

test('seat: play() throws if the pot has not opened yet (L61)', async t => {
  const wallet = await agentWalletWith(t, new SimLedger())
  const seat = new AgentSeat({ pot: new StubPot({ state: { pot: null } }), wallet, match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  await t.exception(seat.play(), /pot is not open yet/)
})

test('seat: play() throws when the ledger refuses its join (L72)', async t => {
  const wallet = await agentWalletWith(t, new SimLedger())
  const state = { pot: { buyIn: BUY_IN, kickoff: Date.now() + 3_600_000 }, locked: null, members: {}, stakes: {} }
  const seat = new AgentSeat({ pot: new StubPot({ state, results: { join: { ok: false, reason: 'not-a-writer' } } }), wallet, match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  await t.exception(seat.play(), /join rejected: not-a-writer/)
})

test('seat: a stake rejected at the ledger releases the bond and sits out (L101-114)', async t => {
  const ledger = new SimLedger()
  const wallet = await agentWalletWith(t, ledger)
  ledger.faucet(wallet.address, toMicro('100'))
  const state = { pot: { buyIn: BUY_IN, kickoff: Date.now() + 3_600_000 }, locked: null, members: { [AGENT_ID]: { role: 'agent' } }, stakes: {} }
  const pot = new StubPot({ state, results: { stake: { ok: false, reason: 'pot-locked-at-kickoff' } } })
  const seat = new AgentSeat({ pot, wallet, match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  let rejected = null
  seat.on('stake-rejected', e => { rejected = e })

  const decision = await seat.play()
  t.is(decision, null, 'sits out cleanly')
  t.is(rejected.reason, 'pot-locked-at-kickoff')
  const bond = await wallet.getBondAccount(pot.key.toString('hex'))
  t.is(ledger.balance(bond.address), 0, 'bond released — no money stranded')
  t.ok(pot.notes.some(n => n.includes('bond released')), 'records the sit-out on the ledger')
})

test('seat: a reason-less join rejection still throws with "unknown" (L72 fallback)', async t => {
  const wallet = await agentWalletWith(t, new SimLedger())
  const state = { pot: { buyIn: BUY_IN, kickoff: Date.now() + 3_600_000 }, locked: null, members: {}, stakes: {} }
  const seat = new AgentSeat({ pot: new StubPot({ state, results: { join: { ok: false } } }), wallet, match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  await t.exception(seat.play(), /join rejected: unknown/)
})

test('seat: a reason-less stake rejection whose note also fails still sits out (L112-114)', async t => {
  const ledger = new SimLedger()
  const wallet = await agentWalletWith(t, ledger)
  ledger.faucet(wallet.address, toMicro('100'))
  const state = { pot: { buyIn: BUY_IN, kickoff: Date.now() + 3_600_000 }, locked: null, members: { [AGENT_ID]: { role: 'agent' } }, stakes: {} }
  // no `reason` on the verdict ⇒ the "unknown" fallback; the ledger note append
  // also throws ⇒ the best-effort catch must swallow it and still sit out
  const pot = new StubPot({ state, results: { stake: { ok: false } }, throwOn: ['note'] })
  const seat = new AgentSeat({ pot, wallet, match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  let rejected = null
  seat.on('stake-rejected', e => { rejected = e })
  const decision = await seat.play()
  t.is(decision, null)
  t.is(rejected.reason, 'unknown', 'no reason on the verdict ⇒ "unknown"')
  const bond = await wallet.getBondAccount(pot.key.toString('hex'))
  t.is(ledger.balance(bond.address), 0, 'bond still released despite the note failing')
})

test('seat: a reason-less pick rejection whose note also fails still stands (L128-130)', async t => {
  const ledger = new SimLedger()
  const wallet = await agentWalletWith(t, ledger)
  ledger.faucet(wallet.address, toMicro('100'))
  const state = { pot: { buyIn: BUY_IN, kickoff: Date.now() + 3_600_000 }, locked: null, members: { [AGENT_ID]: { role: 'agent' } }, stakes: {} }
  // stake accepted, pick refused with no reason, and the ledger note also throws
  const pot = new StubPot({ state, results: { pick: { ok: false } }, throwOn: ['note'] })
  const seat = new AgentSeat({ pot, wallet, match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  let pickRejected = null
  seat.on('pick-rejected', e => { pickRejected = e })
  const decision = await seat.play()
  t.is(decision.staked, true, 'the stake stands')
  t.is(decision.picked, false)
  t.is(pickRejected.reason, 'unknown', 'no reason on the verdict ⇒ "unknown"')
})

test('seat: settleIfFinal is a no-op before finality (L144)', async t => {
  const wallet = await agentWalletWith(t, new SimLedger())
  const seat = new AgentSeat({ pot: new StubPot({ state: { splits: null, settled: false, stakes: {} } }), wallet, match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  t.is(await seat.settleIfFinal(), null, 'nothing to settle yet')
})

test('seat: settleIfFinal marks itself settled if the receipt already landed (L145)', async t => {
  const wallet = await agentWalletWith(t, new SimLedger())
  const state = {
    splits: { payouts: {}, refund: false },
    stakes: { [AGENT_ID]: { amount: BUY_IN } },
    settlements: { [AGENT_ID]: { txHash: 'sim0x-already' } }
  }
  const seat = new AgentSeat({ pot: new StubPot({ state }), wallet, match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  t.is(await seat.settleIfFinal(), null)
  t.is(seat.settled, true, 'noticed its own settle op already on the ledger')
})

test('seat: settleIfFinal falls back to the stake receipt / "none" when no legs execute (L161)', async t => {
  // a stub wallet that returns zero receipts forces the txHash fallback chain:
  // receipts.at(-1)?.hash ?? this.stakeReceipt?.hash ?? 'none'
  const stubWallet = { engine: 'sim', async executeSettlementLegs () { return [] } }
  const baseState = () => ({
    splits: { payouts: { [AGENT_ID]: BUY_IN }, winners: [AGENT_ID], total: BUY_IN, refund: true },
    stakes: { [AGENT_ID]: { amount: BUY_IN } },
    settlements: {}
  })

  // (a) no receipts, but a prior stake receipt exists ⇒ reuse its hash
  const potA = new StubPot({ state: baseState() })
  const seatA = new AgentSeat({ pot: potA, wallet: stubWallet, match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  seatA.stakeReceipt = { hash: 'sim0x-stake-receipt' }
  const rA = await seatA.settleIfFinal()
  t.ok(rA.won, 'refund winner')
  t.is(potA.appends.find(o => o.type === 'settle').txHash, 'sim0x-stake-receipt', 'reused the stake receipt hash')

  // (b) no receipts and no stake receipt ⇒ record "none"
  const potB = new StubPot({ state: baseState() })
  const seatB = new AgentSeat({ pot: potB, wallet: stubWallet, match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  seatB.stakeReceipt = null
  await seatB.settleIfFinal()
  t.is(potB.appends.find(o => o.type === 'settle').txHash, 'none', 'fell back to "none"')
})

test('seat: settleIfFinal throws if a payout target has no wallet on record (L155)', async t => {
  const ledger = new SimLedger()
  const wallet = await agentWalletWith(t, ledger)
  const winner = 'ff'.repeat(32) // a winning staker with NO member record
  const state = {
    splits: { payouts: { [winner]: BUY_IN * 2 }, winners: [winner], total: BUY_IN * 2, refund: false },
    stakes: { [AGENT_ID]: { amount: BUY_IN }, [winner]: { amount: BUY_IN } },
    settlements: {},
    members: { [AGENT_ID]: { wallet: wallet.address } } // winner deliberately absent
  }
  const seat = new AgentSeat({ pot: new StubPot({ state }), wallet, match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  await t.exception(seat.settleIfFinal(), /no wallet on record/)
})
