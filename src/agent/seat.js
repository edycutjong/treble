// AgentSeat — the seam that makes the AI pundit a first-class participant.
//
// The pot sees no difference between the agent and a human: same writer
// grant, same join/stake/pick ops, same kickoff lock. The differences all
// REDUCE the agent's power: its wallet is governed by a WDK Transaction
// Policy (it pre-flights its own allowance with a policy simulation and
// declines pots it cannot afford), and the reducer refuses its votes/locks.
//
// Flow: seat granted → join with wallet address → policy pre-flight →
// brain forms pick → bond the buy-in (REAL transfer receipt) → append
// stake + pick(rationale) → after human consensus, execute settlement legs.

import { EventEmitter } from 'events'
import * as ops from '../core/ops.js'
import { settlementPlan, legsFor } from '../core/settlement.js'
import { fromMicro } from '../core/money.js'
import { formPick } from './pundit.js'

export class AgentSeat extends EventEmitter {
  constructor ({ pot, wallet, match, strategy, brain = 'auto', label }) {
    super()
    this.pot = pot
    this.wallet = wallet
    this.match = match
    this.strategy = strategy
    this.brain = brain
    this.label = label ?? strategy.name
    this.decision = null
    this.stakeReceipt = null
    this.settled = false
  }

  get id () {
    return this.pot.writerKey
  }

  // Ask the humans for a seat and wait until one of them grants it.
  async requestAndWaitForSeat ({ timeoutMs = 120_000 } = {}) {
    if (this.pot.writable) return
    this.pot.requestSeat({ label: this.label, role: 'agent' })
    this.emit('status', `requesting a seat as "${this.label}" (agent) — writer ${this.id.slice(0, 8)}…`)
    let timer = null
    try {
      await Promise.race([
        this.pot.waitWritable(),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('no human granted the seat in time')), timeoutMs)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
    this.emit('status', 'seat granted — I am a writer on the pot ledger')
  }

  // Join, pre-flight the policy, think, stake, pick. Returns the decision.
  async play () {
    await this.requestAndWaitForSeat()

    const state = await this.pot.state()
    if (!state.pot) throw new Error('pot is not open yet')
    if (state.locked) {
      // arrived after kickoff — sit out cleanly, zero money moved
      this.emit('too-late', {})
      return null
    }
    const potKey = this.pot.key.toString('hex')
    const buyIn = state.pot.buyIn

    if (!state.members[this.id]) {
      const joined = await this.pot.append(ops.join({ label: this.label, wallet: this.wallet.address }))
      if (!joined.event?.ok) throw new Error(`join rejected: ${joined.event?.reason ?? 'unknown'}`)
      this.emit('status', `joined the pot as agent — wallet ${this.wallet.address.slice(0, 14)}…`)
    }

    // Bounded autonomy, pre-flighted: simulate the bond transfer against MY
    // OWN Transaction Policy before committing anything.
    const preflight = await this.wallet.simulateStake({ potKey, amount: buyIn })
    this.emit('preflight', preflight)
    if (preflight.decision !== 'ALLOW') {
      const message = `declined: buy-in ${fromMicro(buyIn)} USD₮ exceeds my Transaction Policy cap`
      await this.pot.append(ops.note({ text: `🧢 ${message}` }))
      this.emit('declined', { buyIn, preflight })
      return null
    }

    this.emit('status', `thinking about ${this.match.home} vs ${this.match.away} (brain: ${this.brain})…`)
    this.decision = await formPick({
      match: this.match,
      strategy: this.strategy,
      brain: this.brain,
      buyInUsdt: fromMicro(buyIn),
      /* c8 ignore next 2 -- token/progress callbacks fire only from the live QVAC stream; the disclosed heuristic fallback never streams */
      onToken: token => this.emit('token', token),
      onProgress: progress => this.emit('model-progress', progress)
    })
    this.emit('decision', this.decision)

    this.stakeReceipt = await this.wallet.stakeBond({ potKey, amount: buyIn })

    const staked = await this.pot.append(ops.stake({ amount: buyIn, engine: this.wallet.engine, txHash: this.stakeReceipt.hash }))
    if (!staked.event?.ok) {
      // the ledger refused the stake (e.g. kickoff locked while we were
      // thinking) — release the bond immediately so no money is stranded
      await this.wallet.executeSettlementLegs({
        potKey,
        legs: [{ from: this.id, to: this.id, amount: buyIn, kind: 'release' }],
        /* c8 ignore next -- release-only leg: executeSettlementLegs resolves the self-address, never calling resolveAddress here */
        resolveAddress: () => this.wallet.address
      })
      try {
        await this.pot.append(ops.note({ text: `🧢 stake rejected (${staked.event?.reason ?? 'unknown'}) — bond released, sitting this one out` }))
      } catch {}
      this.emit('stake-rejected', { reason: staked.event?.reason ?? 'unknown' })
      return null
    }
    this.emit('staked', { amount: buyIn, receipt: this.stakeReceipt })

    const picked = await this.pot.append(ops.pick({
      home: this.decision.home,
      away: this.decision.away,
      note: this.decision.rationale
    }))
    if (!picked.event?.ok) {
      // stake stands per protocol (same rule as a human who staked and never
      // picked); say so on the ledger instead of pretending
      try {
        await this.pot.append(ops.note({ text: `⚠ pick rejected (${picked.event?.reason ?? 'unknown'}) — my stake stands per protocol` }))
      } catch {}
      this.emit('pick-rejected', { reason: picked.event?.reason ?? 'unknown' })
      this.decision.staked = true
      this.decision.picked = false
      return this.decision
    }

    this.decision.staked = true
    this.decision.picked = true
    this.emit('picked', this.decision)
    return this.decision
  }

  // Once the humans' consensus finalizes, honour my legs of the plan.
  async settleIfFinal () {
    await this.pot.update()
    const state = await this.pot.state()
    if (!state.splits || this.settled || !state.stakes[this.id]) return null
    if (state.settlements[this.id]) { this.settled = true; return null }

    const potKey = this.pot.key.toString('hex')
    const plan = settlementPlan(state)
    const myLegs = legsFor(plan, this.id)
    const receipts = await this.wallet.executeSettlementLegs({
      potKey,
      legs: myLegs,
      resolveAddress: id => {
        const member = state.members[id]
        if (!member) throw new Error(`no wallet on record for ${id}`)
        return member.wallet
      }
    })
    const lastHash = receipts.at(-1)?.hash ?? this.stakeReceipt?.hash ?? 'none'
    await this.pot.append(ops.settle({ engine: this.wallet.engine, txHash: lastHash }))
    this.settled = true

    const won = (state.splits.payouts[this.id] ?? 0) > 0
    this.emit('settled', { won, payout: state.splits.payouts[this.id] ?? 0, receipts })
    return { won, receipts }
  }
}
