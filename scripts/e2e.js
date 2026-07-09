// End-to-end gate: drives the REAL demo (4 Autobase peers, WDK wallets,
// agent seam) through all three outcomes and asserts the receipts.
// The demo itself throws if Σ or convergence break; we additionally assert
// the outcome-specific facts here. Exit 0 = shippable.

import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const SCENARIOS = [
  { name: 'machine', args: ['--outcome', 'machine'], expect: ['THE MACHINE TAKES THE POT', 'Σ CHECK', 'byte-identical'] },
  { name: 'humans', args: ['--outcome', 'humans'], expect: ['take', 'Σ CHECK', 'byte-identical'] },
  { name: 'refund', args: ['--outcome', 'refund'], expect: ['refund', 'Σ CHECK', 'byte-identical'] },
  // the documented bounded-autonomy variant: buy-in above the agent's policy
  // cap — the pundit must DECLINE on-ledger and the humans play on
  { name: 'decline (cap)', args: ['--buy-in', '50', '--cap', '20'], expect: ['DECLINED', 'policy pre-flight: DENY', 'Σ CHECK', 'byte-identical'] }
]

let failed = 0
for (const scenario of SCENARIOS) {
  process.stdout.write(`e2e: demo ${scenario.args.join(' ')} … `)
  const started = Date.now()
  const run = spawnSync(process.execPath, ['src/cli.js', 'demo', '--ci', ...scenario.args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 120_000
  })
  const output = (run.stdout ?? '') + (run.stderr ?? '')
  const problems = []
  if (run.status !== 0) problems.push(`exit code ${run.status}`)
  for (const needle of scenario.expect) {
    if (!output.includes(needle)) problems.push(`missing "${needle}"`)
  }
  if (!output.includes('REJECTED by every peer')) problems.push('kickoff-lock rejection not demonstrated')
  if (!output.includes('agent-has-no-result-authority')) problems.push('no-oracle rejection not demonstrated')

  if (problems.length === 0) {
    console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)}s)`)
  } else {
    failed++
    console.log('FAILED')
    for (const problem of problems) console.log(`   ✗ ${problem}`)
    console.log(output.split('\n').slice(-15).map(l => '   | ' + l).join('\n'))
  }
}

if (failed > 0) {
  console.error(`\ne2e: ${failed}/${SCENARIOS.length} scenarios failed`)
  process.exit(1)
}
console.log(`\ne2e: all ${SCENARIOS.length} scenarios green — stake→pick→lock→consensus→settlement holds end-to-end`)
