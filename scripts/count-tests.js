// Prints the HONEST test count by actually running the suite and parsing the
// brittle TAP summary. Writes .test-count.json for the readiness checker so
// the number in README can be verified, never invented.

import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const run = spawnSync('npx', ['brittle', 'test/*.test.js'], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: true,
  timeout: 300_000
})
const output = (run.stdout ?? '') + (run.stderr ?? '')
const tests = /# tests = (\d+)\/(\d+) pass/.exec(output)
const asserts = /# asserts = (\d+)\/(\d+) pass/.exec(output)

if (!tests) {
  console.error('could not parse brittle output:\n' + output.split('\n').slice(-10).join('\n'))
  process.exit(1)
}

const summary = {
  passed: Number(tests[1]),
  total: Number(tests[2]),
  assertsPassed: asserts ? Number(asserts[1]) : null,
  assertsTotal: asserts ? Number(asserts[2]) : null,
  allGreen: tests[1] === tests[2] && run.status === 0,
  ranAt: new Date().toISOString()
}
fs.writeFileSync(path.join(ROOT, '.test-count.json'), JSON.stringify(summary, null, 2))
console.log(`${summary.passed}/${summary.total} tests, ${summary.assertsPassed}/${summary.assertsTotal} assertions — ${summary.allGreen ? 'ALL GREEN' : 'FAILURES PRESENT'}`)
process.exit(summary.allGreen ? 0 : 1)
