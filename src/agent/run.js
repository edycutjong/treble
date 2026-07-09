// `npm run agent -- <invite>` — the on-device AI pundit joins a live pot
// over Hyperswarm as a real participant with its own WDK wallet.

import process from 'process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { TreblePot } from '../p2p/pot.js'
import { createTrebleWallet } from '../wallet/index.js'
import { SimLedger } from '../wallet/sim-ledger.js'
import { getStrategy } from './strategies.js'
import { AgentSeat } from './seat.js'
import { toMicro, fromMicro } from '../core/money.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export function parseArgs (argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) args[arg.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i]
    else args._.push(arg)
  }
  return args
}

/* c8 ignore start -- agent CLI entry point: joins a LIVE pot over Hyperswarm, wires stdout event handlers, and drives the AgentSeat lifecycle to process.exit; seat.play()/settleIfFinal() are covered by test/agent-seat.test.js + test/coverage-agent.test.js, wallet by test/wallet.test.js */
export async function runAgent (argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const invite = args._[0]
  if (!invite) {
    console.error('usage: npm run agent -- <treble1…invite> [--strategy gaffer|maverick|professor]')
    console.error('       [--brain auto|qvac|heuristic] [--engine sim|solana] [--cap 20] [--session-cap 25] [--faucet 100]')
    process.exit(1)
  }

  const strategy = getStrategy(args.strategy ?? 'gaffer')
  // default to the DISCLOSED heuristic so a judge's first run never triggers
  // a ~1 GB model download; --brain qvac (or auto) opts into the on-device LLM
  const brain = args.brain ?? 'heuristic'
  const engine = args.engine ?? 'sim'
  const perTxCap = toMicro(args.cap ?? '20')
  const sessionCap = toMicro(args['session-cap'] ?? '25')

  const ledger = engine === 'sim' ? new SimLedger() : null
  const wallet = await createTrebleWallet({
    engine,
    ledger,
    agentPolicy: { perTxCap, sessionCap }
  })
  if (engine === 'sim') {
    ledger.faucet(wallet.address, toMicro(args.faucet ?? '100'))
    console.log('⚠ settlement engine: sim (disclosed local ledger — use --engine solana for devnet)')
  }

  const storage = args.storage ?? fs.mkdtempSync(path.join(os.tmpdir(), 'treble-agent-'))
  const matches = JSON.parse(fs.readFileSync(path.join(HERE, '../../data/fixtures/matches.json'), 'utf8'))

  console.log(`🤖 ${strategy.name} warming up — wallet ${wallet.address.slice(0, 18)}… (cap ${fromMicro(perTxCap)} USD₮/stake)`)
  const pot = await TreblePot.join({ storage, invite })

  // wait until the pot state replicates so we know which match this is
  let state = await pot.state()
  while (!state.pot) {
    await new Promise(resolve => setTimeout(resolve, 300))
    await pot.update()
    state = await pot.state()
  }
  const match = matches[state.pot.matchId] ?? {
    matchId: state.pot.matchId,
    home: state.pot.home,
    away: state.pot.away,
    ratings: { home: 80, away: 80 },
    news: ['no scouting data on file — going on instinct']
  }
  console.log(`🎯 pot found: "${state.pot.name}" — ${state.pot.home} vs ${state.pot.away}, buy-in ${fromMicro(state.pot.buyIn)} USD₮`)

  const seat = new AgentSeat({ pot, wallet, match, strategy, brain })
  seat.on('status', message => console.log(`   ${message}`))
  seat.on('token', token => process.stdout.write(token))
  seat.on('model-progress', p => {
    if (p?.progress != null) process.stdout.write(`\r   downloading model… ${Math.round(p.progress * 100)}%`)
  })
  seat.on('decision', d => {
    if (d.disclosure) console.log(`\n   ⚠ ${d.disclosure}`)
    console.log(`\n🧠 [${d.brain}] ${d.rationale} (confidence ${d.confidence}%)`)
  })
  seat.on('staked', ({ amount, receipt }) => {
    console.log(`💰 staked ${fromMicro(amount)} USD₮ from my own wallet — tx ${receipt.hash}`)
  })
  seat.on('declined', ({ buyIn }) => {
    console.log(`🧢 declined: buy-in ${fromMicro(buyIn)} USD₮ is over my Transaction Policy cap. Bounded autonomy, working as intended.`)
  })
  seat.on('too-late', () => {
    console.log('⏱ this pot is already locked at kickoff — sitting out (zero money moved)')
  })
  seat.on('stake-rejected', ({ reason }) => {
    console.log(`✗ the ledger rejected my stake (${reason}) — bond auto-released, sitting out`)
  })
  seat.on('pick-rejected', ({ reason }) => {
    console.log(`⚠ the ledger rejected my pick (${reason}) — my stake stands per protocol, same as any human who missed the lock`)
  })
  seat.on('settled', ({ won, payout, receipts }) => {
    console.log(won
      ? `🏆 I WON ${fromMicro(payout)} USD₮ — paid to my own wallet (${receipts.length} settlement legs)`
      : `📉 I lost. Paying my debts like a good sport (${receipts.length} settlement legs).`)
  })

  const decision = await seat.play()
  if (!decision) {
    wallet.dispose()
    await pot.close()
    process.exit(0)
  }

  console.log('👀 waiting for kickoff lock and the humans\' consensus result…')
  pot.on('update', async () => {
    try {
      const result = await seat.settleIfFinal()
      if (result) {
        console.log('✅ settled. The ledger has the receipts. Good game.')
        setTimeout(() => { wallet.dispose(); pot.close().then(() => process.exit(0)) }, 1500)
      }
    } catch (err) {
      console.error('settlement error:', err.message)
    }
  })

  process.on('SIGINT', async () => {
    console.log('\n👋 leaving the table')
    wallet.dispose()
    await pot.close()
    process.exit(0)
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runAgent().catch(err => {
    console.error('agent failed:', err)
    process.exit(1)
  })
}
/* c8 ignore stop */
