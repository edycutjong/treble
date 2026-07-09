// Regression tests from the 2026-07-03 self-audit (see docs/AUDIT_REPORT.md §6).

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
import { toMicro } from '../src/core/money.js'

const matches = JSON.parse(fs.readFileSync(new URL('../data/fixtures/matches.json', import.meta.url), 'utf8'))
const BUY_IN = toMicro('20')

function tmpdir (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'treble-audit-'))
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

test('audit: append reports the reducer verdict — success and rejection', async t => {
  const pot = await TreblePot.create({
    storage: tmpdir(t),
    swarm: false,
    pot: { name: 'Verdicts', matchId: 'm', home: 'A', away: 'B', kickoff: Date.now() + 3_600_000, buyIn: BUY_IN }
  })
  t.teardown(() => pot.close())

  const ok = await pot.append(ops.join({ label: 'Ana', wallet: 'w' }))
  t.ok(ok.event.ok, 'valid join reported as accepted')
  t.is(ok.event.type, 'join')

  const dup = await pot.append(ops.join({ label: 'Ana again', wallet: 'w2' }))
  t.absent(dup.event.ok, 'duplicate join reported as rejected')
  t.is(dup.event.reason, 'already-joined')
  t.is(ok.state.members[pot.writerKey].label, 'Ana', 'state kept the original')
})

test('audit: agent arriving at a locked pot sits out with zero money moved', async t => {
  const ledger = new SimLedger()
  const kickoff = Date.now() + 400 // kicks off almost immediately

  const creator = await TreblePot.create({
    storage: tmpdir(t),
    swarm: false,
    pot: { name: 'Late arrival', matchId: 'wc2026-bra-arg', home: 'Brazil', away: 'Argentina', kickoff, buyIn: BUY_IN }
  })
  const agentPot = await TreblePot.join({ storage: tmpdir(t), invite: creator.invite, swarm: false })
  t.teardown(() => creator.close())
  t.teardown(() => agentPot.close())
  link(t, creator, agentPot)

  const agentWallet = await createTrebleWallet({
    engine: 'sim',
    ledger,
    agentPolicy: { perTxCap: BUY_IN, sessionCap: toMicro('25') }
  })
  t.teardown(() => agentWallet.dispose())
  ledger.faucet(agentWallet.address, toMicro('100'))

  // the humans' match starts and locks before the agent shows up
  await creator.approveSeat({ writer: agentPot.writerKey, role: 'agent', label: 'Late Gaffer' })
  await creator.append(ops.join({ label: 'Ana', wallet: 'ana-addr' }))
  await new Promise(resolve => setTimeout(resolve, 600))
  const locked = await creator.append(ops.lock())
  t.ok(locked.event.ok, 'pot locked at kickoff')

  const seat = new AgentSeat({
    pot: agentPot,
    wallet: agentWallet,
    match: matches['wc2026-bra-arg'],
    strategy: STRATEGIES.gaffer,
    brain: 'heuristic'
  })
  let tooLate = false
  seat.on('too-late', () => { tooLate = true })

  // wait until the agent's replica has seen the lock, then let it try
  await until(async () => {
    await creator.update()
    await agentPot.update()
    return (await agentPot.state()).locked
  }, 'lock to reach the agent')
  const decision = await seat.play()

  t.is(decision, null, 'agent refuses to play a locked pot')
  t.ok(tooLate, 'and says why')
  t.is(ledger.spent(agentWallet.address), 0, 'not a micro moved')
  t.is(ledger.balance(agentWallet.address), toMicro('100'), 'wallet untouched')
  const state = await creator.state()
  t.absent(state.stakes[agentPot.writerKey], 'no stake on the ledger')
})
