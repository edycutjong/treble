// Coverage for the CLI's testable surface: the scripted 4-peer demo driven
// in-process across every outcome (machine wins / humans win / refund / pundit
// declines), the pure arg + score + verdict helpers, and the status renderer.
// The interactive REPL (runSession) and the process bootstrap are I/O shells,
// c8-ignored in src/cli.js. The agent entry point's arg parser is covered too.

import test from 'brittle'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { runDemo, parseArgs, parseScore, reportVerdict, printStatus, demoKickoffSecs, preflightNote, demoHeadline } from '../src/cli.js'
import { parseArgs as parseAgentArgs } from '../src/agent/run.js'
import { TreblePot } from '../src/p2p/pot.js'
import { createTrebleWallet } from '../src/wallet/index.js'
import { SimLedger } from '../src/wallet/sim-ledger.js'
import { settlementPlan, legsFor } from '../src/core/settlement.js'
import * as ops from '../src/core/ops.js'
import { toMicro } from '../src/core/money.js'
import { KICKOFF, T } from './helpers.js'

const BUY_IN = toMicro('20')

function tmpdir (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'treble-clicov-'))
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

// Swallow (but keep) the demo's heavy stdout so the coverage of each console
// line is exercised without flooding the test log; assertions read it back.
function captureLogs (t) {
  const logs = []
  const origLog = console.log
  const origErr = console.error
  console.log = (...a) => logs.push(a.join(' '))
  console.error = (...a) => logs.push(a.join(' '))
  t.teardown(() => { console.log = origLog; console.error = origErr })
  return logs
}

function link (t, a, b) {
  const sa = a.store.replicate(true)
  const sb = b.store.replicate(false)
  sa.pipe(sb).pipe(sa)
  sa.on('error', () => {})
  sb.on('error', () => {})
  t.teardown(() => { sa.destroy(); sb.destroy() })
}

async function settle (pots) { for (const p of pots) await p.update() }

async function converge (pots, predicate, tries = 200) {
  for (let i = 0; i < tries; i++) {
    await settle(pots)
    const s = await pots[0].state()
    if (predicate(s)) return s
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('convergence timed out')
}

// ── the scripted demo, every outcome ────────────────────────────────────────

test('cli demo: the machine-outcome run settles zero-sum and converges', async t => {
  const logs = captureLogs(t)
  const result = await runDemo({ ci: true })
  t.is(result.paid, result.total, 'Σ paid == Σ staked (no house cut)')
  t.ok(result.converged, '4 peers reach a byte-identical state hash')
  t.ok(result.decision, 'the pundit played its hand')
  t.ok(logs.some(l => l.includes('zero-sum')), 'the Σ check is reported')
  t.ok(logs.some(l => l.includes('CONVERGENCE')), 'convergence is reported')
})

test('cli demo: the humans-win and refund outcomes both stay zero-sum', async t => {
  captureLogs(t)
  const humans = await runDemo({ ci: true, outcome: 'humans' })
  t.is(humans.paid, humans.total)
  t.ok(humans.converged)

  const refund = await runDemo({ ci: true, outcome: 'refund' })
  t.is(refund.paid, refund.total)
  t.ok(refund.converged)
})

test('cli demo: a cap below the buy-in makes the pundit decline (bounded autonomy)', async t => {
  const logs = captureLogs(t)
  const result = await runDemo({ ci: true, cap: '5' })
  t.is(result.decision, null, 'the pundit declined a pot over its policy cap')
  t.is(result.paid, result.total, 'the humans still settle zero-sum')
  t.ok(logs.some(l => l.includes('DECLINED')), 'the decline is announced and recorded')
})

test('cli demo: the auto brain surfaces its disclosed heuristic fallback in the ticker', async t => {
  // point the on-device model at a missing GGUF so `auto` fails fast (no
  // download) and the DISCLOSED fallback runs — its disclosure must reach the UI
  const prev = process.env.TREBLE_QVAC_MODEL
  process.env.TREBLE_QVAC_MODEL = '/nonexistent/treble-demo-model.gguf'
  t.teardown(() => { if (prev === undefined) delete process.env.TREBLE_QVAC_MODEL; else process.env.TREBLE_QVAC_MODEL = prev })
  const logs = captureLogs(t)
  const result = await runDemo({ ci: true, brain: 'auto' })
  t.is(result.paid, result.total, 'still zero-sum with the fallback brain')
  t.ok(logs.some(l => l.includes('qvac unavailable')), 'the disclosure is shown in the demo ticker')
})

test('cli demo: NO_COLOR renders the ticker in plain text (paint/pad branches)', async t => {
  const prev = process.env.NO_COLOR
  process.env.NO_COLOR = '1'
  t.teardown(() => { if (prev === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = prev })
  const logs = captureLogs(t)
  // cache-busting query so the module re-reads NO_COLOR at import time
  const cli = await import('../src/cli.js?variant=nocolor')
  const result = await cli.runDemo({ ci: true })
  t.is(result.paid, result.total)
  t.ok(logs.some(l => l.includes('THE TREBLE') && !l.includes('[')), 'a plain line carries no ANSI colour codes')
})

// ── pure helpers ────────────────────────────────────────────────────────────

test('cli: parseArgs handles values, boolean flags and a trailing flag', t => {
  const a = parseArgs(['demo', '--outcome', 'humans', '--ci', '--brain'])
  t.is(a._[0], 'demo')
  t.is(a.outcome, 'humans')
  t.is(a.ci, true, 'a flag before another flag is boolean true')
  t.is(a.brain, true, 'a trailing flag is boolean true')
})

test('cli: parseScore parses H-A and rejects junk', t => {
  t.alike(parseScore('2-1', '/pick 2-1'), { home: 2, away: 1 })
  t.exception(() => parseScore('nope', '/pick 2-1'), /usage/)
  t.exception(() => parseScore(undefined, '/pick 2-1'), /usage/)
})

test('cli: reportVerdict prints success, rejection and unknown-reason lines', t => {
  const logs = captureLogs(t)
  reportVerdict({ ok: true }, 'did the thing')
  reportVerdict({ ok: false, reason: 'pot-locked-at-kickoff' }, 'did the thing')
  reportVerdict(null, 'did the thing')
  t.ok(logs.some(l => l.includes('did the thing')), 'success line')
  t.ok(logs.some(l => l.includes('pot-locked-at-kickoff')), 'rejection reason surfaced')
  t.ok(logs.some(l => l.includes('unknown')), 'a null event falls back to "unknown"')
})

test('cli: demoKickoffSecs picks the window for each brain/ci combo', t => {
  t.is(demoKickoffSecs({}, true, false), 10, 'ci window (wide enough for pick replication on slow runners)')
  t.is(demoKickoffSecs({}, true, true), 10, 'ci overrides the real-brain window')
  t.is(demoKickoffSecs({}, false, true), 45, 'the on-device model gets a long window')
  t.is(demoKickoffSecs({}, false, false), 5, 'the heuristic keeps the snappy window')
  t.is(demoKickoffSecs({ 'kickoff-secs': '9' }, true, false), 9, 'an explicit override wins')
})

test('cli: preflightNote falls back matched_rule → reason → engine decision', t => {
  t.is(preflightNote({ matched_rule: 'allow-bounded-usdt-stake' }), 'allow-bounded-usdt-stake')
  t.is(preflightNote({ reason: 'over cap' }), 'over cap')
  t.is(preflightNote({}), 'engine decision')
})

test('cli: demoHeadline covers refund, machine sweep, single and multi-winner', t => {
  t.ok(demoHeadline({ isRefund: true, agentWon: false, winners: ['a'] }).includes('NOBODY CALLED IT'))
  t.ok(demoHeadline({ isRefund: false, agentWon: true, winners: ['a'] }).includes('THE MACHINE TAKES'))
  t.is(demoHeadline({ isRefund: false, agentWon: false, winners: ['Ana'] }), 'Ana takes the pot')
  t.is(demoHeadline({ isRefund: false, agentWon: false, winners: ['Ana', 'Bo'] }), 'Ana & Bo take the pot')
})

test('agent run: parseArgs splits positionals, values and boolean flags', t => {
  const args = parseAgentArgs(['treble1abc', '--strategy', 'maverick', '--brain', '--engine', 'sim'])
  t.is(args._[0], 'treble1abc')
  t.is(args.strategy, 'maverick')
  t.is(args.brain, true, 'a flag immediately followed by another flag is boolean')
  t.is(args.engine, 'sim')
})

// ── printStatus renderer ────────────────────────────────────────────────────

test('cli: printStatus renders an un-opened pot, then a fully-settled one', async t => {
  captureLogs(t)
  const ledger = new SimLedger()
  const wallet = await createTrebleWallet({ engine: 'sim', ledger })
  t.teardown(() => wallet.dispose())
  ledger.faucet(wallet.address, toMicro('100'))

  // an un-opened pot → the "not replicated yet" branch
  const empty = new TreblePot({ storage: tmpdir(t), swarm: false })
  await empty.ready()
  t.teardown(() => empty.close())
  await printStatus(empty, wallet, ledger)

  // a full single-writer lifecycle so every rich branch renders (locked,
  // result, payout, settlement, a note) — timestamps are explicit around KICKOFF
  const pot = await TreblePot.create({ storage: tmpdir(t), swarm: false, pot: { name: 'Status Pot', matchId: 'wc2026-bra-arg', home: 'Brazil', away: 'Argentina', kickoff: KICKOFF, buyIn: BUY_IN } })
  t.teardown(() => pot.close())
  await pot.append(ops.join({ label: 'Ana', wallet: wallet.address, ts: T.before }))
  const receipt = await wallet.stakeBond({ potKey: pot.key.toString('hex'), amount: BUY_IN })
  await pot.append(ops.stake({ amount: BUY_IN, engine: 'sim', txHash: receipt.hash, ts: T.before }))
  await pot.append(ops.pick({ home: 2, away: 1, ts: T.before }))
  await pot.append(ops.note({ text: 'calling it now', ts: T.before }))
  await pot.append(ops.lock({ ts: T.after }))
  await pot.append(ops.vote({ home: 2, away: 1, ts: T.after })) // quorum 1 ⇒ finalizes

  const state = await pot.state()
  const receipts = await wallet.executeSettlementLegs({ potKey: pot.key.toString('hex'), legs: legsFor(settlementPlan(state), pot.writerKey), resolveAddress: id => state.members[id].wallet })
  await pot.append(ops.settle({ engine: 'sim', txHash: receipts.at(-1).hash, ts: T.after }))

  await printStatus(pot, wallet, ledger) // rich render
  await printStatus(pot, wallet, null) // the no-ledger branch
  t.pass('printStatus rendered both the empty and the fully-settled pot')
})

test('cli: printStatus renders an OPEN multi-member pot (not-staked / pick-locked-in / agent)', async t => {
  captureLogs(t)
  const ledger = new SimLedger()
  const wallet = await createTrebleWallet({ engine: 'sim', ledger })
  t.teardown(() => wallet.dispose())
  ledger.faucet(wallet.address, toMicro('100'))

  const ana = await TreblePot.create({ storage: tmpdir(t), swarm: false, pot: { name: 'Open Pot', matchId: 'wc2026-bra-arg', home: 'Brazil', away: 'Argentina', kickoff: KICKOFF, buyIn: BUY_IN } })
  const bo = await TreblePot.join({ storage: tmpdir(t), invite: ana.invite, swarm: false })
  const gaffer = await TreblePot.join({ storage: tmpdir(t), invite: ana.invite, swarm: false })
  t.teardown(() => ana.close())
  t.teardown(() => bo.close())
  t.teardown(() => gaffer.close())
  link(t, ana, bo)
  link(t, ana, gaffer)
  link(t, bo, gaffer)

  await ana.approveSeat({ writer: bo.writerKey, role: 'human', label: 'Bo' })
  await ana.approveSeat({ writer: gaffer.writerKey, role: 'agent', label: 'Gaffer' })
  await converge([ana, bo, gaffer], s => Object.keys(s.writers).length === 3)

  // Ana (self) stakes + picks; Bo (other human) stakes + picks; Gaffer (agent) only joins
  await ana.append(ops.join({ label: 'Ana', wallet: wallet.address, ts: T.before }))
  const anaReceipt = await wallet.stakeBond({ potKey: ana.key.toString('hex'), amount: BUY_IN })
  await ana.append(ops.stake({ amount: BUY_IN, engine: 'sim', txHash: anaReceipt.hash, ts: T.before }))
  await ana.append(ops.pick({ home: 2, away: 1, ts: T.before }))
  await bo.append(ops.join({ label: 'Bo', wallet: 'bo-addr', ts: T.before }))
  await bo.append(ops.stake({ amount: BUY_IN, engine: 'sim', txHash: 'tx-bo', ts: T.before }))
  await bo.append(ops.pick({ home: 0, away: 0, ts: T.before }))
  await gaffer.append(ops.join({ label: 'Gaffer', wallet: 'gaf-addr', ts: T.before }))

  await converge([ana, bo, gaffer], s => Object.keys(s.members).length === 3 && Object.keys(s.picks).length === 2)

  // rendered from Ana's seat, still OPEN: Ana shows her score, Bo shows "pick
  // locked in" (not self, not locked), Gaffer shows "not staked"/"no pick" 🤖
  await printStatus(ana, wallet, ledger)
  t.pass('printStatus rendered the open multi-member pot')
})
