// TreblePot — the serverless pot.
//
// Corestore → Autobase (multi-writer linearization) → Hyperbee view, with the
// deterministic reducer as the ONLY thing that mutates the view. Hyperswarm
// provides the room (topic = the bootstrap's discovery key) and every
// connection is end-to-end encrypted by Hyperswarm's Noise handshake.
//
// Security-critical wiring: `host.addWriter` runs ONLY when the reducer
// accepts an add-writer op. If the reducer rejects it (e.g. the AI pundit
// trying to seat a second bot), the writer is never added to the base.

import { EventEmitter } from 'events'
import Corestore from 'corestore'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import Hyperswarm from 'hyperswarm'
import Protomux from 'protomux'
import c from 'compact-encoding'
import b4a from 'b4a'

import { initialState, reduce } from '../core/reducer.js'
import { OP } from '../core/constants.js'
import * as ops from '../core/ops.js'
import { encodeInvite, decodeInvite } from './invite.js'

const HELLO_PROTOCOL = 'treble/1/hello'

export class TreblePot extends EventEmitter {
  constructor ({ storage, bootstrap = null, swarm = true }) {
    super()
    this.store = new Corestore(storage)
    this.bootstrap = bootstrap
    this.useSwarm = swarm
    this.swarm = null
    this.base = null
    this._helloPeers = new Set()
    this._pendingHello = null
  }

  static async create ({ storage, pot, swarm = true }) {
    const instance = new TreblePot({ storage, bootstrap: null, swarm })
    await instance.ready()
    await instance.append(ops.openPot(pot))
    return instance
  }

  static async join ({ storage, invite, swarm = true }) {
    const bootstrap = decodeInvite(invite)
    const instance = new TreblePot({ storage, bootstrap, swarm })
    await instance.ready()
    return instance
  }

  async ready () {
    this.base = new Autobase(this.store.session(), this.bootstrap, {
      open: store => new Hyperbee(store.get('view'), {
        extension: false,
        keyEncoding: 'utf-8',
        valueEncoding: 'json'
      }),
      apply: applyNodes,
      valueEncoding: 'json'
    })
    this.base.on('update', () => this.emit('update'))
    this.base.on('writable', () => this.emit('writable'))
    await this.base.ready()

    /* c8 ignore start -- live Hyperswarm/DHT: real UDP socket + topic announce; unit tests drive _onConnection/_onHello over an in-process stream pair instead (swarm:false) */
    if (this.useSwarm) {
      this.swarm = new Hyperswarm()
      this.swarm.on('connection', conn => this._onConnection(conn))
      this.swarm.join(this.base.discoveryKey)
    }
    /* c8 ignore stop */
  }

  _onConnection (conn) {
    conn.on('error', () => {}) // peer went away — routine in P2P
    this.store.replicate(conn)

    const mux = Protomux.from(conn)
    const channel = mux.createChannel({ protocol: HELLO_PROTOCOL })
    if (channel === null) return // already open on this stream

    const hello = channel.addMessage({
      encoding: c.json,
      onmessage: msg => this._onHello(msg)
    })
    channel.open()
    this._helloPeers.add(hello)
    conn.on('close', () => this._helloPeers.delete(hello))

    if (this._pendingHello) hello.send(this._pendingHello)
    this.emit('connection', conn)
  }

  _onHello (msg) {
    if (typeof msg !== 'object' || msg === null) return
    if (typeof msg.writer !== 'string' || !/^[0-9a-f]{64}$/.test(msg.writer)) return
    this.emit('seat-request', {
      writer: msg.writer,
      label: String(msg.label ?? 'peer').slice(0, 40),
      role: msg.role === 'agent' ? 'agent' : 'human'
    })
  }

  // Announce "I'd like a seat" to everyone at the table (now and later).
  requestSeat ({ label, role = 'human' }) {
    this._pendingHello = { writer: this.writerKey, label, role }
    for (const hello of this._helloPeers) {
      try { hello.send(this._pendingHello) } catch {}
    }
  }

  // A human at the table grants the seat (reducer enforces who may grant).
  async approveSeat ({ writer, role, label }) {
    return this.append(ops.addWriter({ key: writer, role, label }))
  }

  get key () {
    return this.base.key
  }

  get discoveryKey () {
    return this.base.discoveryKey
  }

  get invite () {
    return encodeInvite(this.base.key)
  }

  get writerKey () {
    return b4a.toString(this.base.local.key, 'hex')
  }

  get writable () {
    return this.base.writable
  }

  async waitWritable () {
    if (this.base.writable) return
    await new Promise(resolve => this.base.once('writable', resolve))
  }

  // Appends an op and reports the reducer's VERDICT for it — callers must
  // never present a rejected op as success (the append always lands in the
  // log; acceptance is decided by every peer's reducer identically).
  async append (op) {
    const before = await this.state()
    await this.base.append(op)
    await this.base.update()
    const state = await this.state()
    const events = await this.events(before.seq)
    const event = events.filter(e => e.from === this.writerKey && e.type === op.type).pop() ?? null
    return { state, event }
  }

  async update () {
    await this.base.update()
  }

  async state () {
    const node = await this.base.view.get('state')
    return node ? node.value : initialState()
  }

  async events (sinceSeq = 0) {
    const out = []
    const start = `event/${String(sinceSeq + 1).padStart(8, '0')}`
    for await (const node of this.base.view.createReadStream({ gte: start, lt: 'event/~' })) {
      out.push(node.value)
    }
    return out
  }

  async close () {
    if (this.swarm) await this.swarm.destroy()
    await this.base.close()
    await this.store.close()
  }
}

// The Autobase apply handler. Runs identically on every peer.
async function applyNodes (nodes, view, host) {
  for (const node of nodes) {
    const from = b4a.toString(node.from.key, 'hex')
    const stateNode = await view.get('state')
    const current = stateNode ? stateNode.value : initialState()

    const { state, event } = reduce(current, node.value, { from })

    // Grant base-level write capability ONLY on reducer-accepted grants.
    if (event.ok && event.type === OP.ADD_WRITER) {
      await host.addWriter(b4a.from(node.value.key, 'hex'), { indexer: true })
    }

    await view.put('state', state)
    await view.put(`event/${String(event.seq).padStart(8, '0')}`, event)
  }
}
