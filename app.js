/* global Pear */
// The Treble — Pear desktop UI. Everything on screen is driven by the same
// tested modules the CLI uses: TreblePot (Autobase/Hyperswarm), the WDK
// wallet layer (real Transaction Policies) and the AgentSeat seam.

import { TreblePot } from './src/p2p/pot.js'
import * as ops from './src/core/ops.js'
import { stateHash } from './src/core/canonical.js'
import { settlementPlan, legsFor } from './src/core/settlement.js'
import { toMicro, fromMicro, fmtUsdt } from './src/core/money.js'
import { createTrebleWallet } from './src/wallet/index.js'
import { SimLedger } from './src/wallet/sim-ledger.js'
import { AgentSeat } from './src/agent/seat.js'
import { getStrategy } from './src/agent/strategies.js'
import matchesData from './data/fixtures/matches.js' // JS twin of matches.json (Bare has no JSON import attributes)

const IS_PEAR = typeof Pear !== 'undefined'
const STORAGE_ROOT = IS_PEAR ? Pear.config.storage : './.treble-ui'
let storageSeq = 0
const nextStorage = () => `${STORAGE_ROOT}/pot-${Date.now()}-${storageSeq++}`

if (IS_PEAR) Pear.teardown(() => shutdown())

const $ = id => document.getElementById(id)
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const state = {
  pot: null, // my TreblePot
  wallet: null,
  ledger: new SimLedger(),
  extras: [], // other in-process pots (demo mode)
  extraWallets: [],
  seat: null,
  lastSeq: 0,
  demo: false,
  countdownTimer: null
}

// ── boot ──────────────────────────────────────────────────────────────────

$('btnDemo').addEventListener('click', () => start(runDemo))
$('btnCreate').addEventListener('click', () => start(runCreate))
$('btnJoin').addEventListener('click', () => {
  const invite = $('inviteInput').value.trim()
  if (!invite.startsWith('treble1')) return toast('paste a treble1… invite first', true)
  start(() => runJoin(invite))
})

async function start (fn) {
  $('startOverlay').classList.add('hidden')
  try {
    await fn()
  } catch (err) {
    toast(err.message, true)
    console.error(err)
  }
}

async function runCreate () {
  const match = matchesData['wc2026-bra-arg']
  state.wallet = await createTrebleWallet({ engine: 'sim', ledger: state.ledger })
  state.ledger.faucet(state.wallet.address, toMicro('100'))
  state.pot = await TreblePot.create({
    storage: nextStorage(),
    pot: {
      name: 'Matchday Pot',
      matchId: match.matchId,
      home: match.home,
      away: match.away,
      kickoff: Date.now() + 10 * 60_000,
      buyIn: toMicro('20')
    }
  })
  wirePot()
  await state.pot.append(ops.join({ label: 'You', wallet: state.wallet.address }))
  toast('pot live — invite copied to the ledger rail')
  logEntry('gold', `invite: ${state.pot.invite}`)
  render()
}

async function runJoin (invite) {
  state.wallet = await createTrebleWallet({ engine: 'sim', ledger: state.ledger })
  state.ledger.faucet(state.wallet.address, toMicro('100'))
  state.pot = await TreblePot.join({ storage: nextStorage(), invite })
  wirePot()
  state.pot.requestSeat({ label: 'Guest', role: 'human' })
  toast('searching Hyperswarm for the pot…')
  render()
}

// The in-window table demo: four real Autobase peers, replicated in-process.
async function runDemo () {
  state.demo = true
  const match = matchesData['wc2026-bra-arg']
  const kickoff = Date.now() + 14_000

  state.pot = await TreblePot.create({
    storage: nextStorage(),
    swarm: false,
    pot: { name: 'Kitchen Table Clásico', matchId: match.matchId, home: match.home, away: match.away, kickoff, buyIn: toMicro('20') }
  })
  const bo = await TreblePot.join({ storage: nextStorage(), invite: state.pot.invite, swarm: false })
  const cai = await TreblePot.join({ storage: nextStorage(), invite: state.pot.invite, swarm: false })
  const gaffer = await TreblePot.join({ storage: nextStorage(), invite: state.pot.invite, swarm: false })
  state.extras = [bo, cai, gaffer]
  linkStores(state.pot, bo); linkStores(state.pot, cai); linkStores(state.pot, gaffer)
  linkStores(bo, cai); linkStores(bo, gaffer); linkStores(cai, gaffer)
  wirePot()

  state.wallet = await createTrebleWallet({ engine: 'sim', ledger: state.ledger })
  const boWallet = await createTrebleWallet({ engine: 'sim', ledger: state.ledger })
  const caiWallet = await createTrebleWallet({ engine: 'sim', ledger: state.ledger })
  const gafferWallet = await createTrebleWallet({
    engine: 'sim',
    ledger: state.ledger,
    agentPolicy: { perTxCap: toMicro('20'), sessionCap: toMicro('25') }
  })
  state.extraWallets = [boWallet, caiWallet, gafferWallet]
  for (const wallet of [state.wallet, boWallet, caiWallet, gafferWallet]) {
    state.ledger.faucet(wallet.address, toMicro('100'))
  }

  await state.pot.approveSeat({ writer: bo.writerKey, role: 'human', label: 'Bo' })
  await state.pot.approveSeat({ writer: cai.writerKey, role: 'human', label: 'Cai' })
  await state.pot.approveSeat({ writer: gaffer.writerKey, role: 'agent', label: 'The Gaffer' })

  const script = [
    { pot: state.pot, wallet: state.wallet, label: 'You', pick: { home: 3, away: 1 } },
    { pot: bo, wallet: boWallet, label: 'Bo', pick: { home: 0, away: 0 } },
    { pot: cai, wallet: caiWallet, label: 'Cai', pick: { home: 1, away: 2 } }
  ]
  for (const human of script) {
    await waitWritable(human.pot)
    await human.pot.append(ops.join({ label: human.label, wallet: human.wallet.address }))
    const receipt = await human.wallet.stakeBond({ potKey: human.pot.key.toString('hex'), amount: toMicro('20') })
    await human.pot.append(ops.stake({ amount: toMicro('20'), engine: 'sim', txHash: receipt.hash }))
    await human.pot.append(ops.pick(human.pick))
    await sleep(700)
  }

  // the machine takes its seat
  state.seat = new AgentSeat({
    pot: gaffer,
    wallet: gafferWallet,
    match,
    strategy: getStrategy('gaffer'),
    brain: 'heuristic' // in-window demo default; the CLI agent can run the QVAC brain
  })
  state.seat.on('status', message => logEntry('ok-agent', `🤖 ${message}`))
  state.seat.on('preflight', p => logEntry('ok-agent', `🤖 policy pre-flight: ${p.decision}`))
  state.seat.on('decision', d => showRationale(`[brain: ${d.brain}] ${d.rationale} — confidence ${d.confidence}%`))
  state.seat.on('staked', ({ amount, receipt }) => logEntry('money', `🤖 autonomously staked ${fmtUsdt(amount)} · tx ${receipt.hash.slice(0, 22)}…`))
  const decision = await state.seat.play()

  // kickoff → cheat attempt → consensus → settlement
  await sleep(Math.max(0, kickoff - Date.now() + 300))
  await state.pot.append(ops.lock())
  await sleep(600)
  await bo.append(ops.pick({ home: decision.home, away: decision.away })) // Bo tries to cheat
  await sleep(900)
  await gaffer.append(ops.vote({ home: 0, away: 9 })) // the machine tries to referee
  await state.pot.append(ops.vote({ home: decision.home, away: decision.away }))
  await bo.append(ops.vote({ home: decision.home, away: decision.away }))

  const finalState = await waitFor(async () => {
    const s = await syncAll()
    return s.splits ? s : null
  })

  const plan = settlementPlan(finalState)
  for (const entry of [{ pot: state.pot, wallet: state.wallet }, { pot: bo, wallet: boWallet }, { pot: cai, wallet: caiWallet }, { pot: gaffer, wallet: gafferWallet }]) {
    const legs = legsFor(plan, entry.pot.writerKey)
    if (legs.length === 0) continue
    const receipts = await entry.wallet.executeSettlementLegs({
      potKey: entry.pot.key.toString('hex'),
      legs,
      resolveAddress: to => finalState.members[to].wallet
    })
    await entry.pot.append(ops.settle({ engine: 'sim', txHash: receipts.at(-1).hash }))
    await sleep(350)
  }
  await syncAll()
  render()
}

// ── pot wiring + rendering ────────────────────────────────────────────────

function wirePot () {
  state.pot.on('update', () => render())
  state.pot.on('seat-request', async request => {
    logEntry('gold', `🙋 "${request.label}" requests a ${request.role} seat (${request.writer.slice(0, 8)}…)`)
    // In the desktop UI the human host approves with one click via confirm()
    const roleTag = request.role === 'agent' ? 'AI PUNDIT' : 'human'
    if (window.confirm(`Grant "${request.label}" a seat as ${roleTag}?`)) {
      await state.pot.approveSeat(request)
      logEntry('gold', `✓ seat granted to ${request.label} (${request.role})`)
    }
  })
  setInterval(() => tickCountdown(), 1000)
  bindDock()
}

function bindDock () {
  $('btnStake').onclick = guard(async () => {
    const s = await state.pot.state()
    if (!s.members[state.pot.writerKey]) await state.pot.append(ops.join({ label: 'You', wallet: state.wallet.address }))
    const receipt = await state.wallet.stakeBond({ potKey: state.pot.key.toString('hex'), amount: s.pot.buyIn })
    await state.pot.append(ops.stake({ amount: s.pot.buyIn, engine: 'sim', txHash: receipt.hash }))
    toast(`staked ${fmtUsdt(s.pot.buyIn)} — ring-fenced in your own bond account`)
  })
  $('btnPick').onclick = guard(async () => {
    const [home, away] = $('pickInput').value.trim().split('-').map(Number)
    await state.pot.append(ops.pick({ home, away }))
    toast(`pick ${home}-${away} appended — immutable from here`)
  })
  $('btnAgent').onclick = guard(async () => {
    toast('run: npm run agent -- <invite> — the pundit joins from its own process/device')
    logEntry('ok-agent', `🤖 seat the AI from a terminal: npm run agent -- ${state.pot.invite}`)
  })
  $('btnLock').onclick = guard(async () => { await state.pot.append(ops.lock()) })
  $('btnVote').onclick = guard(async () => {
    const [home, away] = $('voteInput').value.trim().split('-').map(Number)
    await state.pot.append(ops.vote({ home, away }))
  })
  $('btnSettle').onclick = guard(async () => {
    const s = await state.pot.state()
    const receipts = await state.wallet.executeSettlementLegs({
      potKey: state.pot.key.toString('hex'),
      legs: legsFor(settlementPlan(s), state.pot.writerKey),
      resolveAddress: to => s.members[to].wallet
    })
    await state.pot.append(ops.settle({ engine: 'sim', txHash: receipts.at(-1)?.hash ?? 'no-legs' }))
    toast(`settled ${receipts.length} leg(s) from your bond`)
  })
}

const guard = fn => () => fn().catch(err => toast(err.message, true))

async function render () {
  if (!state.pot) return
  const s = await state.pot.state()
  if (!s.pot) return

  $('matchup').innerHTML = `<b>${esc(s.pot.home)}</b> vs <b>${esc(s.pot.away)}</b> · buy-in ${fmtUsdt(s.pot.buyIn)}`
  const total = Object.values(s.stakes).reduce((sum, stake) => sum + stake.amount, 0)
  $('potAmount').textContent = fmtUsdt(total)
  $('potSub').textContent = s.result
    ? `FINAL ${s.result.home}–${s.result.away}`
    : s.locked ? 'LOCKED — waiting on consensus' : `${Object.keys(s.stakes).length} staked · ${Object.keys(s.members).length} seated`

  renderSeats(s)
  renderLedgerTail()
  renderFinal(s)
  renderDockState(s)

  $('hashTag').textContent = `state ${stateHash(s).slice(0, 10)}…`
  $('syncTag').textContent = `seq ${s.seq} · Autobase ✓`
  const peers = 1 + state.extras.length
  $('peerCount').textContent = state.demo ? `· ${peers} peers (incl. 1 AI)` : ''
}

function renderSeats (s) {
  const ring = $('potRing')
  for (const el of [...ring.querySelectorAll('.seat')]) el.remove()
  const ids = Object.keys(s.members).sort()
  ids.forEach((id, i) => {
    const member = s.members[id]
    const angle = (Math.PI * 2 * i) / Math.max(ids.length, 3) - Math.PI / 2
    const seat = document.createElement('div')
    seat.className = `seat ${member.role === 'agent' ? 'agent' : ''}`
    seat.style.left = `${50 + 46 * Math.cos(angle)}%`
    seat.style.top = `${50 + 46 * Math.sin(angle)}%`
    const initial = member.role === 'agent' ? '🤖' : member.label.slice(0, 1).toUpperCase()
    const pick = s.picks[id]
    const showPick = s.locked || id === state.pot.writerKey
    const payout = s.splits?.payouts?.[id]
    seat.innerHTML = `
      <div class="avatar">${esc(initial)}</div>
      <div class="name">${esc(member.label)}</div>
      <div class="meta">${esc(id.slice(0, 6))}… ${s.stakes[id] ? '· staked' : ''}</div>
      ${pick ? `<span class="pick-chip">${showPick ? `${esc(pick.home)}-${esc(pick.away)}` : 'pick 🔒'}</span>` : ''}
      ${payout ? `<span class="payout-chip">+${esc(fromMicro(payout))} USD₮</span>` : ''}`
    ring.appendChild(seat)
  })
}

async function renderLedgerTail () {
  const events = await state.pot.events(state.lastSeq)
  const s = await state.pot.state()
  for (const event of events) {
    state.lastSeq = Math.max(state.lastSeq, event.seq)
    const who = s.members[event.from]?.label ?? `${event.from.slice(0, 6)}…`
    const isAgent = s.members[event.from]?.role === 'agent'
    if (!event.ok) {
      logEntry('rejected', `✗ ${who} ${event.type} REJECTED — ${event.reason}`)
    } else if (event.type === 'stake') {
      logEntry('money', `${isAgent ? '🤖' : '👤'} ${who} staked ${fmtUsdt(event.info?.amount ?? 0)}`)
    } else if (event.type === 'pick') {
      logEntry(isAgent ? 'ok-agent' : '', `${isAgent ? '🤖' : '👤'} ${who} locked a pick ${s.locked ? `(${event.info.home}-${event.info.away})` : ''}`)
    } else if (event.type === 'lock') {
      logEntry('gold', `🔒 KICKOFF — picks frozen by ${who}`)
    } else if (event.type === 'vote' && event.info?.finalized) {
      logEntry('gold', `✅ consensus: ${event.info.result.home}-${event.info.result.away} (quorum ${event.info.quorum})`)
    } else if (event.type === 'settle') {
      logEntry('money', `💸 ${who} settled (payout ${fromMicro(event.info?.payout ?? 0)} USD₮)`)
    } else {
      logEntry('', `${isAgent ? '🤖' : '·'} ${who} ${event.type}`)
    }
  }
}

function renderFinal (s) {
  const banner = $('finalBanner')
  if (!s.splits) { banner.classList.add('hidden'); return }
  banner.classList.remove('hidden')
  $('finalScore').textContent = `${s.pot.home} ${s.result.home} – ${s.result.away} ${s.pot.away}`
  const paid = Object.values(s.splits.payouts).reduce((a, b) => a + b, 0)
  $('finalSum').textContent = `Σ paid ${fromMicro(paid)} = Σ staked ${fromMicro(s.splits.total)} ✓`
  const agentWon = s.splits.winners.some(id => s.members[id]?.role === 'agent')
  const humanWon = s.splits.winners.some(id => s.members[id]?.role === 'human')
  $('finalRecord').textContent = `Humans ${humanWon ? 1 : 0} – ${agentWon ? 1 : 0} AI Pundit`
}

function renderDockState (s) {
  const me = state.pot.writerKey
  $('btnStake').disabled = !state.pot.writable || Boolean(s.stakes[me]) || Boolean(s.locked)
  $('btnPick').disabled = !s.stakes[me] || Boolean(s.picks[me]) || Boolean(s.locked)
  $('btnAgent').disabled = !s.pot || state.demo
  $('btnLock').disabled = Boolean(s.locked) || Date.now() < (s.pot?.kickoff ?? Infinity)
  $('btnVote').disabled = !s.locked || Boolean(s.result)
  $('btnSettle').disabled = !s.splits || Boolean(s.settlements[me])
}

function tickCountdown () {
  if (!state.pot) return
  state.pot.state().then(s => {
    if (!s.pot) return
    const el = $('countdown')
    if (s.locked) { el.textContent = '🔒 LOCKED'; el.classList.add('locked'); return }
    const ms = s.pot.kickoff - Date.now()
    if (ms <= 0) { el.textContent = 'KICKOFF'; return }
    const m = Math.floor(ms / 60000); const sec = Math.floor((ms % 60000) / 1000)
    el.textContent = `⏱ ${m}:${String(sec).padStart(2, '0')}`
  }).catch(() => {})
}

// ── helpers ───────────────────────────────────────────────────────────────

function linkStores (a, b) {
  const sa = a.store.replicate(true)
  const sb = b.store.replicate(false)
  sa.pipe(sb).pipe(sa)
  sa.on('error', () => {})
  sb.on('error', () => {})
}

async function waitWritable (pot) {
  if (pot.writable) return
  await new Promise(resolve => pot.base.once('writable', resolve))
}

async function syncAll () {
  await state.pot.update()
  for (const extra of state.extras) await extra.update()
  const s = await state.pot.state()
  render()
  return s
}

async function waitFor (fn, tries = 400) {
  for (let i = 0; i < tries; i++) {
    const value = await fn()
    if (value) return value
    await sleep(25)
  }
  throw new Error('timed out')
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function showRationale (text) {
  $('rationale').classList.remove('hidden')
  const target = $('rationaleText')
  target.textContent = ''
  let i = 0
  const timer = setInterval(() => {
    target.textContent = text.slice(0, ++i)
    if (i >= text.length) clearInterval(timer)
  }, 18)
}

function logEntry (kind, text) {
  const ledger = $('ledger')
  const entry = document.createElement('div')
  entry.className = `entry ${kind}`
  entry.textContent = text
  ledger.appendChild(entry)
  ledger.scrollTop = ledger.scrollHeight
}

function toast (message, isError = false) {
  const el = $('toast')
  el.textContent = message
  el.classList.toggle('error', isError)
  el.classList.remove('hidden')
  clearTimeout(el._t)
  el._t = setTimeout(() => el.classList.add('hidden'), 3600)
}

async function shutdown () {
  try {
    for (const wallet of [state.wallet, ...state.extraWallets]) wallet?.dispose()
    for (const pot of [state.pot, ...state.extras]) await pot?.close()
  } catch {}
}
