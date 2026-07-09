// Multi-writer integration over real Corestore/Autobase replication streams
// (piped in-process — no sockets, same wire protocol Hyperswarm carries).

import test from 'brittle'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { TreblePot } from '../src/p2p/pot.js'
import { stateHash } from '../src/core/canonical.js'
import * as ops from '../src/core/ops.js'
import { toMicro } from '../src/core/money.js'
import { KICKOFF, T } from './helpers.js'

const BUY_IN = toMicro('20')

function tmpdir (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'treble-test-'))
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function potOpts () {
  return {
    name: 'Test Clasico',
    matchId: 'test-bra-arg',
    home: 'Brazil',
    away: 'Argentina',
    kickoff: KICKOFF,
    buyIn: BUY_IN,
    ts: T.before
  }
}

async function createPot (t, extra = {}) {
  const pot = await TreblePot.create({ storage: tmpdir(t), pot: potOpts(), swarm: false, ...extra })
  t.teardown(() => pot.close())
  return pot
}

async function joinPot (t, invite) {
  const pot = await TreblePot.join({ storage: tmpdir(t), invite, swarm: false })
  t.teardown(() => pot.close())
  return pot
}

function link (t, a, b) {
  const sa = a.store.replicate(true)
  const sb = b.store.replicate(false)
  sa.pipe(sb).pipe(sa)
  sa.on('error', () => {})
  sb.on('error', () => {})
  t.teardown(() => { sa.destroy(); sb.destroy() })
}

async function converged (a, b, tries = 100) {
  for (let i = 0; i < tries; i++) {
    await a.update()
    await b.update()
    const [sa, sb] = [await a.state(), await b.state()]
    if (stateHash(sa) === stateHash(sb) && sa.seq > 0) return sa
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('peers did not converge')
}

async function raceTimeout (promise, ms, what) {
  let timer = null
  try {
    await Promise.race([
      promise,
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`timeout: ${what}`)), ms) })
    ])
  } finally {
    clearTimeout(timer)
  }
}

test('p2p: creating a pot opens it in the view', async t => {
  const pot = await createPot(t)
  const state = await pot.state()
  t.is(state.pot.name, 'Test Clasico')
  t.is(state.pot.buyIn, BUY_IN)
  t.ok(pot.writable, 'creator is writable immediately')
  t.is(state.writers[pot.writerKey].role, 'human')
})

test('p2p: invite round-trips the bootstrap key', async t => {
  const pot = await createPot(t)
  t.ok(pot.invite.startsWith('treble1'))
  const clone = await joinPot(t, pot.invite)
  t.alike(clone.key, pot.key)
  t.alike(clone.discoveryKey, pot.discoveryKey)
})

test('p2p: joiner becomes writable after a human grants the seat', async t => {
  const creator = await createPot(t)
  const joiner = await joinPot(t, creator.invite)
  link(t, creator, joiner)

  t.absent(joiner.writable, 'no capability before the grant')
  await creator.approveSeat({ writer: joiner.writerKey, role: 'human', label: 'Bo' })

  await raceTimeout(joiner.waitWritable(), 10_000, 'writable')
  t.ok(joiner.writable)

  await joiner.append(ops.join({ label: 'Bo', wallet: 'addr-bo', ts: T.before }))
  const state = await converged(creator, joiner)
  t.is(state.members[joiner.writerKey].label, 'Bo')
  t.is(state.members[joiner.writerKey].role, 'human')
})

test('p2p: full stake→pick flow converges to identical state hashes', async t => {
  const creator = await createPot(t)
  const joiner = await joinPot(t, creator.invite)
  link(t, creator, joiner)

  await creator.approveSeat({ writer: joiner.writerKey, role: 'human', label: 'Bo' })
  await raceTimeout(joiner.waitWritable(), 10_000, 'writable')

  await creator.append(ops.join({ label: 'Ana', wallet: 'addr-ana', ts: T.before }))
  await joiner.append(ops.join({ label: 'Bo', wallet: 'addr-bo', ts: T.before }))
  await creator.append(ops.stake({ amount: BUY_IN, engine: 'sim', txHash: 'tx-ana', ts: T.before2 }))
  await joiner.append(ops.stake({ amount: BUY_IN, engine: 'sim', txHash: 'tx-bo', ts: T.before2 }))
  await creator.append(ops.pick({ home: 2, away: 1, ts: T.before3 }))
  await joiner.append(ops.pick({ home: 0, away: 0, ts: T.before3 }))

  const state = await converged(creator, joiner)
  t.is(Object.keys(state.stakes).length, 2)
  t.is(Object.keys(state.picks).length, 2)
  t.is(state.picks[creator.writerKey].home, 2)
  t.is(state.picks[joiner.writerKey].home, 0)
})

test('p2p: an agent-granted writer never gains write capability (security wiring)', async t => {
  const creator = await createPot(t)
  const agent = await joinPot(t, creator.invite)
  const intruder = await joinPot(t, creator.invite)
  link(t, creator, agent)
  link(t, creator, intruder)
  link(t, agent, intruder)

  await creator.approveSeat({ writer: agent.writerKey, role: 'agent', label: 'Gaffer' })
  await raceTimeout(agent.waitWritable(), 10_000, 'agent writable')
  await agent.append(ops.join({ label: 'Gaffer', wallet: 'addr-g', ts: T.before }))

  // the AI pundit tries to seat an accomplice — the reducer must refuse,
  // so host.addWriter never runs and the intruder stays read-only
  await agent.append(ops.addWriter({ key: intruder.writerKey, role: 'agent', label: 'Bot2', ts: T.before }))

  const state = await converged(creator, agent)
  t.absent(state.writers[intruder.writerKey], 'no grant recorded')
  const grantEvents = (await creator.events()).filter(e => e.type === 'add-writer' && e.from === agent.writerKey)
  t.is(grantEvents.length, 1)
  t.absent(grantEvents[0].ok)
  t.is(grantEvents[0].reason, 'agent-cannot-add-writers')
  t.absent(intruder.writable, 'intruder never became writable')
})

test('p2p: three peers converge — humans and the machine on one ledger', async t => {
  const ana = await createPot(t)
  const bo = await joinPot(t, ana.invite)
  const gaffer = await joinPot(t, ana.invite)
  link(t, ana, bo)
  link(t, ana, gaffer)
  link(t, bo, gaffer)

  await ana.approveSeat({ writer: bo.writerKey, role: 'human', label: 'Bo' })
  await ana.approveSeat({ writer: gaffer.writerKey, role: 'agent', label: 'Gaffer' })
  await raceTimeout(bo.waitWritable(), 10_000, 'bo writable')
  await raceTimeout(gaffer.waitWritable(), 10_000, 'gaffer writable')

  await ana.append(ops.join({ label: 'Ana', wallet: 'a', ts: T.before }))
  await bo.append(ops.join({ label: 'Bo', wallet: 'b', ts: T.before }))
  await gaffer.append(ops.join({ label: 'Gaffer', wallet: 'g', ts: T.before }))

  for (const peer of [ana, bo, gaffer]) {
    await peer.append(ops.stake({ amount: BUY_IN, engine: 'sim', txHash: `tx-${peer.writerKey.slice(0, 6)}`, ts: T.before2 }))
  }
  await ana.append(ops.pick({ home: 2, away: 1, ts: T.before3 }))
  await bo.append(ops.pick({ home: 1, away: 1, ts: T.before3 }))
  await gaffer.append(ops.pick({ home: 2, away: 1, note: 'High press, open flank.', ts: T.before3 }))

  // converge before kickoff so the lock cannot causally fork ahead of a pick
  await converged(ana, bo)
  await converged(bo, gaffer)

  await ana.append(ops.lock({ ts: T.after }))
  await ana.append(ops.vote({ home: 2, away: 1, ts: T.after }))
  await bo.append(ops.vote({ home: 2, away: 1, ts: T.after }))

  const sAna = await converged(ana, bo)
  const sBo = await converged(bo, gaffer)
  t.is(stateHash(sAna), stateHash(sBo), 'all three peers agree byte-for-byte')

  t.ok(sAna.result, 'quorum reached')
  t.alike(sAna.splits.winners.sort(), [ana.writerKey, gaffer.writerKey].sort(), 'Ana and the AI split it')
  t.is(sAna.splits.total, BUY_IN * 3)
  t.is(Object.values(sAna.splits.payouts).reduce((a, b) => a + b, 0), BUY_IN * 3, 'Σ payouts == Σ stakes across the wire')
})

test('p2p: the event ledger is readable as a range', async t => {
  const pot = await createPot(t)
  await pot.append(ops.join({ label: 'Ana', wallet: 'a', ts: T.before }))
  const events = await pot.events()
  t.is(events.length, 2)
  t.is(events[0].type, 'open')
  t.is(events[1].type, 'join')
  const later = await pot.events(1)
  t.is(later.length, 1)
  t.is(later[0].type, 'join')
})
