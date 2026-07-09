// "It's really P2P" verifier (workflow-mandated).
//
// Default (offline, CI-safe): two real Autobase peers replicate over piped
// streams — the exact wire protocol Hyperswarm carries — while we stream the
// merge events and prove (a) no HTTP/TCP *server* was ever opened, and
// (b) both peers converge to byte-identical state.
//
// With --swarm: additionally joins the pot topic on the REAL Hyperswarm DHT
// and reports discovered/holepunched connections (needs internet).

import fs from 'fs'
import os from 'os'
import path from 'path'
import net from 'net'
import http from 'http'

import { TreblePot } from '../src/p2p/pot.js'
import * as ops from '../src/core/ops.js'
import { stateHash } from '../src/core/canonical.js'
import { toMicro } from '../src/core/money.js'

const useSwarm = process.argv.includes('--swarm')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'treble-verify-'))

// tripwires: prove the app never opens a listening server socket
let serversOpened = 0
for (const [mod, name] of [[net, 'net'], [http, 'http']]) {
  const original = mod.createServer.bind(mod)
  mod.createServer = (...args) => {
    serversOpened++
    console.log(`✗ TRIPWIRE: ${name}.createServer called!`)
    return original(...args)
  }
}

console.log('The Treble — P2P verifier\n')
console.log(`mode: ${useSwarm ? 'LIVE Hyperswarm DHT (--swarm)' : 'offline replication streams (add --swarm for the live DHT)'}\n`)

const kickoff = Date.now() + 3_600_000
const a = await TreblePot.create({
  storage: tmp(),
  swarm: useSwarm,
  pot: { name: 'Verify Pot', matchId: 'verify', home: 'Peers', away: 'Servers', kickoff, buyIn: toMicro('1') }
})
console.log(`① pot created — bootstrap key ${a.key.toString('hex').slice(0, 16)}…`)
console.log(`   invite: ${a.invite}`)

const b = await TreblePot.join({ storage: tmp(), invite: a.invite, swarm: useSwarm })
if (!useSwarm) {
  const sa = a.store.replicate(true)
  const sb = b.store.replicate(false)
  sa.pipe(sb).pipe(sa)
  sa.on('error', () => {})
  sb.on('error', () => {})
  console.log('② peer B attached over a raw replication stream (same protocol Hyperswarm carries, Noise-encrypted on the wire)')
} else {
  console.log('② peer B joined the pot topic on the public Hyperswarm DHT…')
  a.on('connection', () => console.log('   ⚡ peer connection established (holepunched or direct)'))
  await new Promise(resolve => setTimeout(resolve, 8000))
}

let updates = 0
b.on('update', () => { updates++ })

await a.approveSeat({ writer: b.writerKey, role: 'human', label: 'PeerB' })
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('peer B never became writable — replication failed')), 30_000)
  b.base.once('writable', () => { clearTimeout(timer); resolve() })
})
console.log('③ writer capability granted via an on-ledger op — peer B is now writable')

await b.append(ops.join({ label: 'PeerB', wallet: 'verify-wallet' }))
await a.append(ops.join({ label: 'PeerA', wallet: 'verify-wallet-a' }))
for (let i = 0; i < 5; i++) {
  await (i % 2 ? a : b).append(ops.note({ text: `merge probe ${i}` }))
}

let converged = false
for (let i = 0; i < 200 && !converged; i++) {
  await a.update()
  await b.update()
  const [sa, sb] = [await a.state(), await b.state()]
  converged = sa.seq === sb.seq && sa.seq >= 8 && stateHash(sa) === stateHash(sb)
  if (!converged) await new Promise(resolve => setTimeout(resolve, 25))
}
const finalA = await a.state()
console.log(`④ ${updates} Autobase merge updates streamed on peer B`)
console.log(`⑤ convergence: seq=${finalA.seq}, state hash ${stateHash(finalA).slice(0, 20)}… on BOTH peers: ${converged ? '✓' : '✗'}`)

const handles = process._getActiveHandles?.() ?? []
const serverHandles = handles.filter(h => h instanceof net.Server)
console.log(`⑥ server tripwire: ${serversOpened === 0 && serverHandles.length === 0 ? '✓ zero server sockets opened — there is nothing to point a browser at' : `✗ ${serversOpened} createServer calls / ${serverHandles.length} live servers`}`)

await a.close()
await b.close()

if (!converged || serversOpened > 0 || serverHandles.length > 0) {
  console.error('\nverify:p2p FAILED')
  process.exit(1)
}
console.log('\nverify:p2p ✓ — multi-writer state converged with no server anywhere')
process.exit(0)
