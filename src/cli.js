#!/usr/bin/env node
// The Treble CLI.
//
//   node src/cli.js demo            — full humans-vs-machine match, one process,
//                                     four REAL Autobase peers, zero network needed
//   node src/cli.js create …        — open a live pot on Hyperswarm (prints invite)
//   node src/cli.js join <invite>   — join a live pot from another terminal/device
//
// The interactive session and the demo share the exact same modules the tests
// exercise — there is no separate "demo codepath".

import process from 'process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import readline from 'readline/promises'
import { fileURLToPath } from 'url'

import { TreblePot } from './p2p/pot.js'
import * as ops from './core/ops.js'
import { stateHash } from './core/canonical.js'
import { settlementPlan, legsFor } from './core/settlement.js'
import { toMicro, fromMicro, fmtUsdt } from './core/money.js'
import { createTrebleWallet } from './wallet/index.js'
import { SimLedger } from './wallet/sim-ledger.js'
import { AgentSeat } from './agent/seat.js'
import { getStrategy } from './agent/strategies.js'
import { shortKey } from './p2p/invite.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NO_COLOR = Boolean(process.env.NO_COLOR)
const paint = (code, text) => NO_COLOR ? text : `\x1b[${code}m${text}\x1b[0m`
const bold = t => paint(1, t)
const dim = t => paint(2, t)
const gold = t => paint(33, t)
const green = t => paint(32, t)
const cyan = t => paint(36, t)
const red = t => paint(31, t)

function tmpdir (prefix = 'treble-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function loadMatches () {
  return JSON.parse(fs.readFileSync(path.join(HERE, '../data/fixtures/matches.json'), 'utf8'))
}

export function parseArgs (argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) args[arg.slice(2)] = argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i]
    else args._.push(arg)
  }
  return args
}

function link (a, b) {
  const sa = a.store.replicate(true)
  const sb = b.store.replicate(false)
  sa.pipe(sb).pipe(sa)
  sa.on('error', () => {})
  sb.on('error', () => {})
}

async function settleAll (pots) {
  for (const pot of pots) await pot.update()
}

async function untilState (pots, predicate, what, tries = 1200) {
  for (let i = 0; i < tries; i++) {
    await settleAll(pots)
    const state = await pots[0].state()
    if (predicate(state)) return state
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  /* c8 ignore next 2 -- defensive demo timeout: the in-process 4-peer demo always converges within `tries`; this fires only if replication stalls */
  const s = await pots[0].state()
  throw new Error(`demo timed out waiting for ${what} (picks=${Object.keys(s.picks).length} stakes=${Object.keys(s.stakes).length} writers=${Object.keys(s.writers).length})`)
}

// ── the scripted match ────────────────────────────────────────────────────

// Pure demo helpers, unit-tested directly. A real on-device model needs thinking
// time; a 5s kickoff window would lock the pot before the agent (which stakes,
// THEN picks) can commit — so qvac/auto get a generous window, the instant
// heuristic keeps the snappy demo, and --kickoff-secs overrides either.
// CI note: the window starts at demo start and must outlast seat-grant + stake +
// pick REPLICATION across 4 in-process peers. A cold CI runner (esp. Node 24)
// can spend >2s on first Autobase append/JIT, locking picks out (picks=0). 10s
// gives ample margin while keeping the suite quick.
export function demoKickoffSecs (args, ci, realBrain) {
  return Number(args['kickoff-secs'] ?? (ci ? 10 : (realBrain ? 45 : 5)))
}

// The policy pre-flight note: whichever the WDK engine surfaced, else a label.
export function preflightNote (p) {
  return p.matched_rule ?? p.reason ?? 'engine decision'
}

// The closing headline: refund, machine sweep, or the human winner(s).
export function demoHeadline ({ isRefund, agentWon, winners }) {
  return isRefund
    ? 'NOBODY CALLED IT — full refund, every stake returned'
    : agentWon
      ? 'THE MACHINE TAKES THE POT'
      : `${winners.join(' & ')} take${winners.length === 1 ? 's' : ''} the pot`
}

export async function runDemo (args) {
  const ci = Boolean(args.ci)
  const outcome = args.outcome ?? 'machine' // machine | humans | refund
  const realBrain = args.brain === 'qvac' || args.brain === 'auto'
  const kickoffSecs = demoKickoffSecs(args, ci, realBrain)
  const matches = loadMatches()
  const match = matches['wc2026-bra-arg']
  const buyIn = toMicro(args['buy-in'] ?? '20')

  console.log(bold('\n⚽ THE TREBLE — humans vs. the machine, no server, no house, no cloud\n'))
  console.log(dim('   settlement engine: sim (disclosed local ledger — swap --engine solana for devnet)'))
  console.log(dim('   four REAL Autobase peers replicate in this process; the wire protocol is the same one Hyperswarm carries\n'))

  const ledger = new SimLedger()
  const kickoff = Date.now() + kickoffSecs * 1000

  // ── the table ──
  const ana = await TreblePot.create({
    storage: tmpdir(),
    swarm: false,
    pot: { name: 'Kitchen Table Clásico', matchId: match.matchId, home: match.home, away: match.away, kickoff, buyIn }
  })
  const bo = await TreblePot.join({ storage: tmpdir(), invite: ana.invite, swarm: false })
  const cai = await TreblePot.join({ storage: tmpdir(), invite: ana.invite, swarm: false })
  const gafferPot = await TreblePot.join({ storage: tmpdir(), invite: ana.invite, swarm: false })
  const pots = [ana, bo, cai, gafferPot]
  link(ana, bo); link(ana, cai); link(ana, gafferPot); link(bo, cai); link(bo, gafferPot); link(cai, gafferPot)

  console.log(`${gold('🏆 pot opened')}  "${bold('Kitchen Table Clásico')}" — ${match.home} vs ${match.away}, buy-in ${fmtUsdt(buyIn)}`)
  console.log(`   invite: ${cyan(ana.invite)}\n`)

  // ── wallets (one shared sim ledger so Σ is checkable end-to-end) ──
  const wallets = {
    [ana.writerKey]: await createTrebleWallet({ engine: 'sim', ledger }),
    [bo.writerKey]: await createTrebleWallet({ engine: 'sim', ledger }),
    [cai.writerKey]: await createTrebleWallet({ engine: 'sim', ledger })
  }
  const agentWallet = await createTrebleWallet({
    engine: 'sim',
    ledger,
    agentPolicy: { perTxCap: toMicro(args.cap ?? '20'), sessionCap: toMicro(args['session-cap'] ?? '25') }
  })
  wallets[gafferPot.writerKey] = agentWallet
  for (const wallet of Object.values(wallets)) ledger.faucet(wallet.address, toMicro('100'))

  // ── humans take their seats ──
  await ana.approveSeat({ writer: bo.writerKey, role: 'human', label: 'Bo' })
  await ana.approveSeat({ writer: cai.writerKey, role: 'human', label: 'Cai' })
  await ana.approveSeat({ writer: gafferPot.writerKey, role: 'agent', label: 'The Gaffer' })
  await untilState(pots, s => Object.keys(s.writers).length === 4, 'seat grants to replicate')

  const humans = [
    { pot: ana, label: 'Ana', pick: { home: 3, away: 1 } },
    { pot: bo, label: 'Bo', pick: { home: 0, away: 0 } },
    { pot: cai, label: 'Cai', pick: { home: 1, away: 2 } }
  ]
  for (const human of humans) {
    const wallet = wallets[human.pot.writerKey]
    await human.pot.append(ops.join({ label: human.label, wallet: wallet.address }))
    const receipt = await wallet.stakeBond({ potKey: human.pot.key.toString('hex'), amount: buyIn })
    await human.pot.append(ops.stake({ amount: buyIn, engine: 'sim', txHash: receipt.hash }))
    await human.pot.append(ops.pick(human.pick))
    console.log(`${green('👤 ' + human.label.padEnd(4))} staked ${fmtUsdt(buyIn)} ${dim('tx ' + receipt.hash.slice(0, 18) + '…')}  pick ${bold(`${human.pick.home}-${human.pick.away}`)} ${dim('(keys on their own device)')}`)
  }

  // ── the machine takes its seat ──
  console.log(`\n${cyan('🤖 THE GAFFER')} ${dim(`(writer ${shortKey(gafferPot.writerKey)}, its OWN keypair + WDK wallet, Transaction Policy cap ${fromMicro(toMicro(args.cap ?? '20'))} USD₮)`)}`)
  const seat = new AgentSeat({
    pot: gafferPot,
    wallet: agentWallet,
    match,
    strategy: getStrategy(args.strategy ?? 'gaffer'),
    brain: args.brain ?? 'heuristic'
  })
  seat.on('status', message => console.log(dim(`   ${message}`)))
  seat.on('preflight', p => console.log(cyan(`   policy pre-flight: ${p.decision}`) + dim(` (${preflightNote(p)})`)))
  seat.on('decision', d => {
    if (d.disclosure) console.log(dim(`   ⚠ ${d.disclosure}`))
    console.log(cyan(`   🧠 [brain: ${d.brain}] `) + `"${d.rationale}" ${dim(`confidence ${d.confidence}%`)}`)
  })
  seat.on('staked', ({ amount, receipt }) => console.log(cyan(`   💰 autonomously staked ${fmtUsdt(amount)}`) + dim(` tx ${receipt.hash.slice(0, 18)}… from its own wallet`)))
  const decision = await seat.play()

  if (!decision) {
    await untilState(pots, s => s.notes.length > 0, 'the decline note to replicate')
    console.log(red('   🧢 THE GAFFER DECLINED — buy-in is above its Transaction Policy cap.'))
    console.log(dim('      Bounded autonomy, working as intended: the decline is recorded on the shared ledger and the humans play on.'))
  }

  const expectedPicks = decision ? 4 : 3
  const preLock = await untilState(pots, s => Object.keys(s.picks).length === expectedPicks, 'all picks to replicate')
  const bonded = Object.values(preLock.stakes).reduce((sum, stake) => sum + stake.amount, 0)
  console.log(`\n${gold('📒 ledger')}  ${expectedPicks} picks locked in, ${fmtUsdt(bonded)} in bonds — every player signed with their own key`)

  // ── kickoff ──
  const waitMs = kickoff - Date.now()
  if (waitMs > 0) {
    console.log(dim(`\n⏱  waiting ${Math.ceil(waitMs / 1000)}s for kickoff…`))
    await new Promise(resolve => setTimeout(resolve, waitMs + 200))
  }
  await ana.append(ops.lock())
  console.log(gold('🔒 KICKOFF — pot locked on the shared append-only ledger'))

  // Bo tries to sneak-edit his pick after kickoff
  const tempting = decision ? { home: decision.home, away: decision.away } : { home: 9, away: 9 }
  await bo.append(ops.pick(tempting))
  const afterCheat = await untilState(
    pots,
    s => s.locked !== null,
    'lock to replicate'
  )
  await settleAll(pots)
  const cheatEvents = (await ana.events()).filter(e => e.type === 'pick' && !e.ok && e.from === bo.writerKey)
  /* c8 ignore next 2 -- demo self-check: Bo's post-kickoff edit is always rejected AND replicated (cheatEvents[0].reason present) and his stored pick stays 0-0; the ?? fallback + invariant throw are unreachable when reducer I1 (pick immutability, reducer.test.js) holds */
  console.log(red(`🚫 Bo tried to change his pick after kickoff → REJECTED by every peer (${cheatEvents[0]?.reason ?? 'pot-locked-at-kickoff'})`))
  if (afterCheat.picks[bo.writerKey].home !== 0) throw new Error('demo invariant broken: Bo pick changed')

  // ── full-time: humans agree on what happened; the machine has NO say ──
  const finalScore = outcome === 'machine' && decision
    ? { home: decision.home, away: decision.away }
    : outcome === 'refund'
      ? { home: 9, away: 9 }
      : humans[0].pick
  console.log(`\n${bold('📺 FULL TIME:')} ${match.home} ${finalScore.home} – ${finalScore.away} ${match.away} ${dim('(humans confirm by consensus vote — the AI has no result authority)')}`)

  await gafferPot.append(ops.vote({ home: 0, away: 9 })) // the machine tries anyway
  await ana.append(ops.vote(finalScore))
  await bo.append(ops.vote(finalScore))

  const finalState = await untilState(pots, s => s.splits !== null, 'consensus finality')
  const agentVoteEvent = (await ana.events()).find(e => e.type === 'vote' && e.from === gafferPot.writerKey)
  console.log(red(`🚫 the machine tried to vote on the result → REJECTED (${agentVoteEvent?.reason})`))
  console.log(green(`✅ result finalized by ${finalState.result.voters.length}/3 staked humans (quorum)`))

  // ── settlement: everyone honours the deterministic plan ──
  const plan = settlementPlan(finalState)
  console.log(`\n${gold('💸 settlement')} — escrowless: winners release their own bond, losers pay winners, every leg policy-checked`)
  for (const pot of pots) {
    const id = pot.writerKey
    const myLegs = legsFor(plan, id)
    if (myLegs.length === 0) continue
    const wallet = wallets[id]
    const receipts = await wallet.executeSettlementLegs({
      potKey: pot.key.toString('hex'),
      legs: myLegs,
      resolveAddress: to => finalState.members[to].wallet
    })
    await pot.append(ops.settle({ engine: 'sim', txHash: receipts.at(-1).hash }))
    const label = finalState.members[id].label
    for (const { leg, hash } of receipts) {
      const verb = leg.kind === 'release' ? 'released own bond' : `paid ${finalState.members[leg.to].label}`
      console.log(`   ${label.padEnd(10)} ${verb.padEnd(22)} ${fmtUsdt(leg.amount).padStart(12)}  ${dim('tx ' + hash.slice(0, 18) + '…')}`)
    }
  }

  const settled = await untilState(pots, s => Object.keys(s.settlements).length === Object.keys(s.stakes).length, 'settle receipts')

  // ── the receipts ──
  const total = settled.splits.total
  const paid = Object.values(settled.splits.payouts).reduce((a, b) => a + b, 0)
  const isRefund = settled.splits.refund
  const winners = settled.splits.winners.map(id => settled.members[id].label)
  const agentWon = !isRefund && settled.splits.winners.includes(gafferPot.writerKey)
  const machinePoints = agentWon ? 1 : 0
  const humanPoints = !isRefund && settled.splits.winners.some(id => settled.members[id].role === 'human') ? 1 : 0

  /* c8 ignore next 2 -- demo self-check: the escrowless split conserves value (Σ payouts == Σ stakes; settlement.test.js + reducer I2), so paid===total always ⇒ the ✗ and throw arms are unreachable */
  console.log(`\n${bold('Σ CHECK')}  paid ${fmtUsdt(paid)} == staked ${fmtUsdt(total)}  ${paid === total ? green('✓ zero-sum, no house cut') : red('✗ BROKEN')}`)
  if (paid !== total) throw new Error('accounting invariant broken')

  const hashes = []
  for (const pot of pots) hashes.push(stateHash(await pot.state()))
  const converged = hashes.every(h => h === hashes[0])
  /* c8 ignore next 2 -- demo self-check: every peer applies the same linearized log through the same reducer, so the state hashes always converge (reducer I5; pot-p2p.test.js) ⇒ the ✗ and throw arms are unreachable */
  console.log(`${bold('CONVERGENCE')}  4 peers, state hash ${dim(hashes[0].slice(0, 16) + '…')}  ${converged ? green('✓ byte-identical everywhere') : red('✗ DIVERGED')}`)
  if (!converged) throw new Error('convergence invariant broken')

  const headline = demoHeadline({ isRefund, agentWon, winners })
  console.log(`\n${bold('🏁 ' + headline)}  ${dim(`Humans ${humanPoints} – ${machinePoints} AI Pundit`)}`)
  for (const [id, member] of Object.entries(settled.members).sort()) {
    const balance = ledger.balance(wallets[id].address)
    const delta = balance - toMicro('100')
    const deltaLabel = delta === 0 ? '±0' : (delta > 0 ? '+' : '−') + fromMicro(Math.abs(delta))
    const roleTag = member.role === 'agent' ? cyan('[AI]') : green('[human]')
    const status = settled.stakes[id] ? `(${deltaLabel})` : dim('(sat out — over policy cap)')
    console.log(`   ${member.label.padEnd(10)} ${roleTag.padEnd(NO_COLOR ? 8 : 17)} wallet ${fromMicro(balance).padStart(7)} USD₮  ${status}`)
  }
  console.log(dim('\n   every stake, pick, rationale, rejection and receipt above lives on a replicated'))
  console.log(dim('   append-only Autobase ledger — verify with: npm run verify:p2p\n'))

  for (const wallet of Object.values(wallets)) wallet.dispose()
  for (const pot of pots) await pot.close()
  return { paid, total, converged, agentWon, decision }
}

// ── live P2P session (create/join over Hyperswarm) ───────────────────────

/* c8 ignore start -- interactive REPL: opens a live pot over Hyperswarm (real DHT) and reads commands from process.stdin via readline; the ledger ops it issues (append/stake/pick/vote/settle) are covered by the reducer, p2p, wallet and seat suites, and the demo path is covered in-process */
async function runSession (args, mode) {
  const matches = loadMatches()
  const engine = args.engine ?? 'sim'
  const label = args.label ?? (mode === 'create' ? 'Creator' : 'Player')
  const ledger = engine === 'sim' ? new SimLedger() : null
  const wallet = await createTrebleWallet({ engine, ledger })
  if (engine === 'sim') {
    ledger.faucet(wallet.address, toMicro(args.faucet ?? '100'))
    console.log(dim('⚠ settlement engine: sim (disclosed local ledger — use --engine solana for devnet)'))
  }

  let pot
  if (mode === 'create') {
    const matchId = args.match ?? 'wc2026-bra-arg'
    const match = matches[matchId]
    if (!match) throw new Error(`unknown match ${matchId} — options: ${Object.keys(matches).join(', ')}`)
    pot = await TreblePot.create({
      storage: args.storage ?? tmpdir('treble-live-'),
      pot: {
        name: args.name ?? `${match.home} v ${match.away} pot`,
        matchId,
        home: match.home,
        away: match.away,
        kickoff: Date.now() + Number(args['kickoff-mins'] ?? 30) * 60_000,
        buyIn: toMicro(args['buy-in'] ?? '20')
      }
    })
    console.log(`${gold('🏆 pot live on Hyperswarm')} — share this invite:`)
    console.log(`\n   ${cyan(bold(pot.invite))}\n`)
    console.log(dim('   (a friend: node src/cli.js join <invite> — the AI: npm run agent -- <invite>)'))
  } else {
    pot = await TreblePot.join({ storage: args.storage ?? tmpdir('treble-live-'), invite: args._[1] })
    console.log(dim('🔎 looking for the pot on Hyperswarm…'))
    pot.requestSeat({ label, role: 'human' })
  }

  pot.on('seat-request', request => {
    console.log(`\n${gold('🙋 seat request')}: "${request.label}" wants to sit as ${request.role === 'agent' ? cyan('AI PUNDIT') : green('human')} — writer ${shortKey(request.writer)}`)
    console.log(dim(`   approve with: /approve ${request.writer.slice(0, 8)} ${request.role}`))
    pendingSeats.set(request.writer.slice(0, 8), request)
  })
  pot.on('update', async () => { /* state surfaced via /status */ })

  const pendingSeats = new Map()
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  console.log(dim('\ncommands: /status /stake /pick H-A /note text /lock /vote H-A /settle /approve <key8> [human|agent] /invite /quit'))

  while (true) {
    const line = (await rl.question(`${label}> `)).trim()
    if (!line) continue
    const [cmd, ...rest] = line.split(/\s+/)
    try {
      if (cmd === '/quit') break
      else if (cmd === '/invite') console.log(cyan(pot.invite))
      else if (cmd === '/status') await printStatus(pot, wallet, ledger)
      else if (cmd === '/approve') {
        const request = pendingSeats.get(rest[0])
        if (!request) { console.log(red(`no pending seat request matching "${rest[0]}"`)); continue }
        const role = rest[1] ?? request.role
        await pot.approveSeat({ writer: request.writer, role, label: request.label })
        console.log(green(`✓ granted ${request.label} a ${role} seat`))
      } else if (cmd === '/stake') {
        if (!pot.writable) throw new Error('no seat yet — the host must /approve you first')
        const state = await pot.state()
        if (!state.pot) throw new Error('pot not replicated yet — try again in a moment')
        if (state.locked) throw new Error('pot is locked at kickoff')
        if (state.stakes[pot.writerKey]) throw new Error('already staked')
        if (!state.members[pot.writerKey]) {
          const joined = await pot.append(ops.join({ label, wallet: wallet.address }))
          if (!joined.event?.ok) throw new Error(`join rejected: ${joined.event?.reason}`)
        }
        const receipt = await wallet.stakeBond({ potKey: pot.key.toString('hex'), amount: state.pot.buyIn })
        const res = await pot.append(ops.stake({ amount: state.pot.buyIn, engine, txHash: receipt.hash }))
        if (!res.event?.ok) {
          await wallet.executeSettlementLegs({
            potKey: pot.key.toString('hex'),
            legs: [{ from: pot.writerKey, to: pot.writerKey, amount: state.pot.buyIn, kind: 'release' }],
            resolveAddress: () => wallet.address
          })
          throw new Error(`stake rejected by the ledger (${res.event?.reason}) — bond auto-released`)
        }
        console.log(green(`✓ staked ${fmtUsdt(state.pot.buyIn)} — tx ${receipt.hash}`))
      } else if (cmd === '/pick') {
        const score = parseScore(rest[0], '/pick 2-1')
        const res = await pot.append(ops.pick(score))
        reportVerdict(res.event, `pick ${score.home}-${score.away} locked in (immutable once accepted)`)
      } else if (cmd === '/note') {
        if (rest.length === 0) throw new Error('usage: /note your message')
        const res = await pot.append(ops.note({ text: rest.join(' ') }))
        reportVerdict(res.event, 'note on the ledger')
      } else if (cmd === '/lock') {
        const res = await pot.append(ops.lock())
        reportVerdict(res.event, '🔒 pot locked — picks are frozen on every peer')
      } else if (cmd === '/vote') {
        const score = parseScore(rest[0], '/vote 2-1')
        const res = await pot.append(ops.vote(score))
        reportVerdict(res.event, `voted ${score.home}-${score.away}${res.event?.info?.finalized ? ' — RESULT FINALIZED' : ''}`)
      } else if (cmd === '/settle') {
        const state = await pot.state()
        const receipts = await wallet.executeSettlementLegs({
          potKey: pot.key.toString('hex'),
          legs: legsFor(settlementPlan(state), pot.writerKey),
          resolveAddress: to => state.members[to].wallet
        })
        const res = await pot.append(ops.settle({ engine, txHash: receipts.at(-1)?.hash ?? 'no-legs' }))
        reportVerdict(res.event, `settled ${receipts.length} leg(s)`)
      } else console.log(red(`unknown command ${cmd}`))
    } catch (err) {
      console.log(red(`✗ ${err.message}`))
    }
  }
  rl.close()
  await pot.close()
  wallet.dispose()
}
/* c8 ignore stop */

// Never present a reducer-rejected op as success.
export function reportVerdict (event, successMessage) {
  if (event?.ok) console.log(green(`✓ ${successMessage}`))
  else console.log(red(`✗ rejected by the ledger: ${event?.reason ?? 'unknown'}`))
}

export function parseScore (raw, usage) {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(raw ?? '')
  if (!match) throw new Error(`usage: ${usage}`)
  return { home: Number(match[1]), away: Number(match[2]) }
}

export async function printStatus (pot, wallet, ledger) {
  await pot.update()
  const state = await pot.state()
  if (!state.pot) { console.log(dim('pot not replicated yet…')); return }
  console.log(`\n${bold(state.pot.name)} — ${state.pot.home} v ${state.pot.away}, buy-in ${fmtUsdt(state.pot.buyIn)}`)
  console.log(`kickoff ${new Date(state.pot.kickoff).toLocaleTimeString()} ${state.locked ? red('· LOCKED') : green('· open for picks')}${state.result ? gold(` · FINAL ${state.result.home}-${state.result.away}`) : ''}`)
  for (const [id, member] of Object.entries(state.members)) {
    const stake = state.stakes[id] ? `staked ${fmtUsdt(state.stakes[id].amount)}` : 'not staked'
    const pick = state.picks[id] ? (state.locked || id === pot.writerKey ? `pick ${state.picks[id].home}-${state.picks[id].away}` : 'pick locked in') : 'no pick'
    const payout = state.splits?.payouts?.[id] ? ` → wins ${fmtUsdt(state.splits.payouts[id])}` : ''
    console.log(`  ${member.role === 'agent' ? '🤖' : '👤'} ${member.label.padEnd(12)} ${stake.padEnd(18)} ${pick}${payout}${state.settlements[id] ? ' ✓settled' : ''}`)
  }
  for (const note of state.notes.slice(-3)) console.log(dim(`  💬 ${state.members[note.from]?.label}: ${note.text}`))
  if (ledger) console.log(dim(`  my wallet: ${fromMicro(ledger.balance(wallet.address))} USD₮ (${wallet.address.slice(0, 16)}…)`))
  console.log(dim(`  state hash: ${stateHash(state).slice(0, 16)}… · events: ${state.seq}`))
}

// ── entrypoint ────────────────────────────────────────────────────────────

/* c8 ignore start -- CLI process bootstrap: argv parsing, command dispatch and process.exit; runDemo (the demo path) is driven in-process by test/coverage-cli.test.js and runSession is the interactive REPL ignored above */
async function main () {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]

  try {
    if (command === 'demo') {
      await runDemo(args)
      process.exit(0)
    } else if (command === 'create') {
      await runSession(args, 'create')
      process.exit(0)
    } else if (command === 'join') {
      if (!args._[1]) throw new Error('usage: node src/cli.js join <treble1…invite>')
      await runSession(args, 'join')
      process.exit(0)
    } else {
      console.log(`${bold('The Treble')} — trustless prediction pot with an on-device AI opponent\n`)
      console.log('  node src/cli.js demo                 scripted humans-vs-machine match (offline, ~15s)')
      console.log('      [--outcome machine|humans|refund] [--brain heuristic|qvac|auto] [--ci]')
      console.log('  node src/cli.js create               open a live pot on Hyperswarm')
      console.log('      [--name …] [--match wc2026-bra-arg] [--buy-in 20] [--kickoff-mins 30] [--engine sim|solana]')
      console.log('  node src/cli.js join <invite>        join a live pot [--label You]')
      console.log('  npm run agent -- <invite>            the on-device AI pundit joins a pot')
      process.exit(command ? 1 : 0)
    }
  } catch (err) {
    console.error(red(`\n✗ ${err.message}`))
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
/* c8 ignore stop */
