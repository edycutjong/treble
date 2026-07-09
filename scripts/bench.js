// Reproducible benchmarks (workflow-mandated `scripts/bench`):
//   1. reducer throughput          — pure consensus core, ops/sec
//   2. append → convergence        — 2 real Autobase peers over replication streams
//   3. agent pick → staked-on-ledger — the full seam, heuristic brain
// Prints p50/p95/mean and writes bench-results.json next to this script.
// Methodology is in the output — no numbers without a way to re-run them.

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

import { initialState, reduce } from '../src/core/reducer.js'
import * as ops from '../src/core/ops.js'
import { TreblePot } from '../src/p2p/pot.js'
import { stateHash } from '../src/core/canonical.js'
import { createTrebleWallet } from '../src/wallet/index.js'
import { SimLedger } from '../src/wallet/sim-ledger.js'
import { AgentSeat } from '../src/agent/seat.js'
import { getStrategy } from '../src/agent/strategies.js'
import { toMicro } from '../src/core/money.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const matches = JSON.parse(fs.readFileSync(path.join(HERE, '../data/fixtures/matches.json'), 'utf8'))

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
function stats (samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  return {
    n: samples.length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    mean,
    min: sorted[0],
    max: sorted.at(-1)
  }
}
const fmt = (s, unit = 'ms') =>
  `n=${String(s.n).padStart(4)}  p50=${s.p50.toFixed(2)}${unit}  p95=${s.p95.toFixed(2)}${unit}  mean=${s.mean.toFixed(2)}${unit}  min=${s.min.toFixed(2)}${unit}  max=${s.max.toFixed(2)}${unit}`

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'treble-bench-'))
const results = {}

console.log('The Treble — reproducible bench (run: npm run bench)\n')
console.log(`host: ${os.platform()} ${os.arch()}, node ${process.version}, ${os.cpus()[0]?.model ?? 'cpu'}\n`)

// ── 1. reducer throughput ────────────────────────────────────────────────
{
  const KEYS = Array.from({ length: 8 }, (_, i) => String(i).repeat(64).slice(0, 64))
  const kickoff = 2_000_000_000_000
  const buyIn = toMicro('20')
  const rounds = 200
  const samples = []
  for (let round = 0; round < rounds; round++) {
    const start = performance.now()
    let { state } = reduce(initialState(), ops.openPot({ name: 'B', matchId: 'm', home: 'A', away: 'B', kickoff, buyIn, ts: 1000 }), { from: KEYS[0] })
    for (let i = 1; i < 8; i++) ({ state } = reduce(state, ops.addWriter({ key: KEYS[i], role: i === 7 ? 'agent' : 'human', label: `P${i}`, ts: 1001 }), { from: KEYS[0] }))
    for (let i = 0; i < 8; i++) ({ state } = reduce(state, ops.join({ label: `P${i}`, wallet: `w${i}`, ts: 1002 }), { from: KEYS[i] }))
    for (let i = 0; i < 8; i++) ({ state } = reduce(state, ops.stake({ amount: buyIn, engine: 'sim', txHash: `t${i}`, ts: 1003 }), { from: KEYS[i] }))
    for (let i = 0; i < 8; i++) ({ state } = reduce(state, ops.pick({ home: i % 4, away: (i + 1) % 3, ts: 1004 }), { from: KEYS[i] }))
    ;({ state } = reduce(state, ops.lock({ ts: kickoff + 1 }), { from: KEYS[0] }))
    for (let i = 0; i < 7; i++) ({ state } = reduce(state, ops.vote({ home: 0, away: 1, ts: kickoff + 2 }), { from: KEYS[i] }))
    samples.push(performance.now() - start)
  }
  const opsPerPot = 8 * 4 + 8 // 40 ops per pot lifecycle
  const s = stats(samples)
  results.reducer = { ...s, opsPerSecond: Math.round(opsPerPot / (s.mean / 1000)) }
  console.log('1. reducer — full 8-member pot lifecycle (40 ops incl. finality+split)')
  console.log(`   ${fmt(s)}  ≈ ${results.reducer.opsPerSecond.toLocaleString()} ops/s\n`)
}

// ── 2. append → 2-peer convergence ───────────────────────────────────────
{
  const kickoff = Date.now() + 3_600_000
  const a = await TreblePot.create({ storage: tmp(), swarm: false, pot: { name: 'Bench', matchId: 'm', home: 'A', away: 'B', kickoff, buyIn: toMicro('20') } })
  const b = await TreblePot.join({ storage: tmp(), invite: a.invite, swarm: false })
  const sa = a.store.replicate(true); const sb = b.store.replicate(false)
  sa.pipe(sb).pipe(sa); sa.on('error', () => {}); sb.on('error', () => {})
  await a.approveSeat({ writer: b.writerKey, role: 'human', label: 'B' })
  await new Promise(resolve => b.base.once('writable', resolve))
  await a.append(ops.join({ label: 'A', wallet: 'wa' }))
  await b.append(ops.join({ label: 'B', wallet: 'wb' }))

  const rounds = 60
  const samples = []
  for (let i = 0; i < rounds; i++) {
    const writer = i % 2 === 0 ? a : b
    const reader = i % 2 === 0 ? b : a
    const start = performance.now()
    await writer.append(ops.note({ text: `bench-${i}` }))
    for (;;) {
      await reader.update()
      const [sw, sr] = [await writer.state(), await reader.state()]
      if (sw.seq === sr.seq && stateHash(sw) === stateHash(sr)) break
      await new Promise(resolve => setImmediate(resolve))
    }
    samples.push(performance.now() - start)
  }
  results.convergence = stats(samples)
  console.log('2. P2P — append on one peer → byte-identical state on the other (real Autobase replication)')
  console.log(`   ${fmt(results.convergence)}\n`)
  await a.close(); await b.close()
}

// ── 3. agent pick → stake on ledger ──────────────────────────────────────
{
  const rounds = 20
  const samples = []
  for (let i = 0; i < rounds; i++) {
    const ledger = new SimLedger()
    const kickoff = Date.now() + 3_600_000
    const creator = await TreblePot.create({ storage: tmp(), swarm: false, pot: { name: 'Bench', matchId: 'wc2026-bra-arg', home: 'Brazil', away: 'Argentina', kickoff, buyIn: toMicro('20') } })
    const agentPot = await TreblePot.join({ storage: tmp(), invite: creator.invite, swarm: false })
    const s1 = creator.store.replicate(true); const s2 = agentPot.store.replicate(false)
    s1.pipe(s2).pipe(s1); s1.on('error', () => {}); s2.on('error', () => {})
    const wallet = await createTrebleWallet({ engine: 'sim', ledger, agentPolicy: { perTxCap: toMicro('20'), sessionCap: toMicro('25') } })
    ledger.faucet(wallet.address, toMicro('100'))
    await creator.approveSeat({ writer: agentPot.writerKey, role: 'agent', label: 'G' })

    const seat = new AgentSeat({ pot: agentPot, wallet, match: matches['wc2026-bra-arg'], strategy: getStrategy('gaffer'), brain: 'heuristic' })
    const start = performance.now()
    await seat.play() // seat grant wait + join + policy preflight + brain + bond + stake + pick
    samples.push(performance.now() - start)
    wallet.dispose()
    await creator.close(); await agentPot.close()
  }
  results.agentSeam = stats(samples)
  console.log('3. agent seam — seat grant → policy pre-flight → pick formed → bonded & on the ledger (heuristic brain)')
  console.log(`   ${fmt(results.agentSeam)}`)
  console.log('   (QVAC-brain latency depends on local model/hardware — run the agent with --brain qvac to measure yours)\n')
}

const outPath = path.join(HERE, '../bench-results.json')
fs.writeFileSync(outPath, JSON.stringify({ host: { platform: os.platform(), arch: os.arch(), node: process.version }, results, ranAt: new Date().toISOString() }, null, 2))
console.log(`✓ wrote ${path.relative(process.cwd(), outPath)}`)
