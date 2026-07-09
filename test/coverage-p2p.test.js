// Coverage for the TreblePot connection layer without any DHT: _onConnection is
// driven over a real @hyperswarm/secret-stream pair (exactly what a Hyperswarm
// connection IS) tunnelled through an in-process socket pair, so the hello
// pairing channel and store replication run over the true wire protocol. The
// message handler, the seat-request broadcast and the swarm teardown are
// exercised directly. The live `new Hyperswarm()` + DHT announce is c8-ignored.

import test from 'brittle'
import fs from 'fs'
import os from 'os'
import net from 'net'
import path from 'path'
import SecretStream from '@hyperswarm/secret-stream'
import { TreblePot } from '../src/p2p/pot.js'
import { toMicro } from '../src/core/money.js'
import { KICKOFF, T } from './helpers.js'

const BUY_IN = toMicro('20')

function tmpdir (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'treble-p2pcov-'))
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function potOpts () {
  return { name: 'Cov Clasico', matchId: 'test-bra-arg', home: 'Brazil', away: 'Argentina', kickoff: KICKOFF, buyIn: BUY_IN, ts: T.before }
}

async function until (fn, what, tries = 200) {
  for (let i = 0; i < tries; i++) {
    const value = await fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${what}`)
}

// A Hyperswarm-style encrypted connection pair over localhost sockets (no DHT).
async function encryptedPair (t) {
  const { srv, rawA, rawB } = await new Promise((resolve) => {
    const server = net.createServer((incoming) => resolve({ srv: server, rawA: outgoing, rawB: incoming }))
    let outgoing
    server.listen(0, () => { outgoing = net.connect(server.address().port) })
  })
  const a = new SecretStream(true, rawA)
  const b = new SecretStream(false, rawB)
  t.teardown(() => { a.destroy(); b.destroy(); srv.close() })
  return { a, b }
}

test('pot: a Hyperswarm-style connection carries a hello seat-request and replicates (no DHT)', async t => {
  const ana = await TreblePot.create({ storage: tmpdir(t), swarm: false, pot: potOpts() })
  const bo = await TreblePot.join({ storage: tmpdir(t), invite: ana.invite, swarm: false })
  t.teardown(() => ana.close())
  t.teardown(() => bo.close())

  const requests = []
  ana.on('seat-request', r => requests.push(r))
  let connEmitted = false
  ana.on('connection', () => { connEmitted = true })

  const { a, b } = await encryptedPair(t)
  bo.requestSeat({ label: 'Bo', role: 'agent' }) // queue a pending hello so it sends on connect
  ana._onConnection(a)
  bo._onConnection(b)

  const seen = await until(() => requests.length ? requests : null, 'the seat-request over the encrypted stream')
  t.is(seen[0].writer, bo.writerKey)
  t.is(seen[0].label, 'Bo')
  t.is(seen[0].role, 'agent')
  t.ok(connEmitted, 'the connection event surfaced')

  // the same muxed stream replicates the pot state to the joiner
  const state = await until(async () => { await bo.update(); const s = await bo.state(); return s.pot ? s : null }, 'pot state to replicate to bo')
  t.is(state.pot.name, 'Cov Clasico')

  // tearing the connection down fires the conn error + close handlers
  await new Promise((resolve) => { a.on('close', resolve); a.destroy(new Error('peer gone')) })
})

test('pot: _onHello ignores malformed messages and surfaces valid seat requests (L96-103)', async t => {
  const pot = await TreblePot.create({ storage: tmpdir(t), swarm: false, pot: potOpts() })
  t.teardown(() => pot.close())
  const seen = []
  pot.on('seat-request', r => seen.push(r))

  pot._onHello(null) // not an object → ignored
  pot._onHello('nope') // not an object → ignored
  pot._onHello({ writer: 'too-short' }) // malformed writer → ignored
  pot._onHello({ writer: 'ab'.repeat(32) }) // valid, defaults
  pot._onHello({ writer: 'cd'.repeat(32), label: 'x'.repeat(80), role: 'agent' }) // clamped label, agent role

  t.is(seen.length, 2, 'only the two well-formed hellos surface')
  t.is(seen[0].label, 'peer', 'missing label defaults to "peer"')
  t.is(seen[0].role, 'human', 'unknown role defaults to human')
  t.is(seen[1].role, 'agent')
  t.is(seen[1].label.length, 40, 'label clamped to 40 chars')
})

test('pot: requestSeat broadcasts to live peers and swallows a dead one (L108-110)', async t => {
  const pot = await TreblePot.create({ storage: tmpdir(t), swarm: false, pot: potOpts() })
  t.teardown(() => pot.close())
  const sent = []
  pot._helloPeers.add({ send: (m) => sent.push(m) })
  pot._helloPeers.add({ send: () => { throw new Error('peer gone') } }) // must be swallowed

  pot.requestSeat({ label: 'Ana', role: 'human' })
  t.is(sent.length, 1, 'the live peer received the hello')
  t.is(sent[0].label, 'Ana')
  t.is(sent[0].role, 'human')
  t.is(sent[0].writer, pot.writerKey)
})

test('pot: a duplicate connection on the same stream is a no-op (L83)', async t => {
  const ana = await TreblePot.create({ storage: tmpdir(t), swarm: false, pot: potOpts() })
  t.teardown(() => ana.close())
  const { a } = await encryptedPair(t)
  ana._onConnection(a)
  const size = ana._helloPeers.size
  ana._onConnection(a) // the hello channel is already open on this stream ⇒ createChannel === null ⇒ early return
  t.is(ana._helloPeers.size, size, 'no second hello peer registered for the same stream')
})

test('pot: append returns a null verdict for an op with no matching event (L154)', async t => {
  const pot = await TreblePot.create({ storage: tmpdir(t), swarm: false, pot: potOpts() })
  t.teardown(() => pot.close())
  // a typeless op reduces to a reject event of type "unknown" ⇒ the writer/type
  // filter finds nothing ⇒ the verdict falls back to null
  const res = await pot.append({ v: 1, ts: Date.now() })
  t.is(res.event, null, 'no attributable verdict event ⇒ null')
})

test('pot: close tears down an attached swarm (L175)', async t => {
  const pot = await TreblePot.create({ storage: tmpdir(t), swarm: false, pot: potOpts() })
  let destroyed = false
  pot.swarm = { destroy: async () => { destroyed = true } } // stand in for a live Hyperswarm
  await pot.close()
  t.ok(destroyed, 'the swarm was destroyed before the base and store closed')
})
