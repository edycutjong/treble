// Submission readiness gate (workflow-mandated). Fails while ANY claim in
// the shipping docs is unearned: placeholders, missing deliverables, a stale
// test count, a wrong license. Run before every submission update.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), 'utf8') : null

const failures = []
const warnings = []
const ok = []

function requireFile (p, why) {
  if (read(p) === null) failures.push(`missing ${p} — ${why}`)
  else ok.push(`${p} present`)
}

// ── mandatory deliverables ──
requireFile('README.md', 'judges read this first')
requireFile('docs/DEMO.md', 'exact demo steps are a workflow deliverable')
requireFile('docs/ARCHITECTURE.md', 'architecture doc with Mermaid is mandatory')
requireFile('docs/SUBMISSION.md', 'submission copy')
requireFile('docs/SPONSOR_DEFENSE.md', 'why-only-this-stack brief')
requireFile('LICENSE', 'hackathon rule #5')
requireFile('landing/index.html', 'landing page deliverable')
requireFile('scripts/bench.js', 'reproducible benchmark deliverable')
requireFile('scripts/verify_p2p.js', 'P2P proof deliverable')
requireFile('scripts/verify_offline.js', 'on-device proof deliverable')
requireFile('docs/AUDIT_REPORT.md', 'self-audit with invariants + residual risk')
requireFile('docs/friction-log.md', 'DX report for sponsor tracks')
requireFile('.github/workflows/ci.yml', 'CI pipeline')

// ── license must be Apache-2.0 (hackathon rule), not MIT ──
const license = read('LICENSE')
if (license && !license.includes('Apache License')) failures.push('LICENSE is not Apache-2.0 (hackathon rule #5)')
else if (license) ok.push('LICENSE is Apache-2.0')
const pkg = JSON.parse(read('package.json'))
if (pkg.license !== 'Apache-2.0') failures.push(`package.json license is ${pkg.license}, must be Apache-2.0`)
else ok.push('package.json license Apache-2.0')

// ── placeholder scan in judge-facing docs ──
const PLACEHOLDER_PATTERNS = [
  /⬜/u, /\bFILL\b/, /\bTBD\b/, /\bTODO\b/, /XXX+/, /lorem ipsum/i,
  /your-video/i, /example\.com/, /<insert/i, /\[FILL/i
]
for (const doc of ['README.md', 'SUBMISSION.md', 'DEMO.md', 'the-treble_dorahacks_submission.md']) {
  const content = read(doc)
  if (content === null) continue
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const match = pattern.exec(content)
    if (match) failures.push(`${doc} contains placeholder "${match[0]}" — fill it or mark the claim as pending honestly`)
  }
}

// ── test-count claims must match reality (.test-count.json from npm run test:count) ──
const countFile = read('.test-count.json')
if (!countFile) {
  failures.push('no .test-count.json — run `npm run test:count` first')
} else {
  const count = JSON.parse(countFile)
  if (!count.allGreen) failures.push(`test suite not green (${count.passed}/${count.total})`)
  else ok.push(`test suite green: ${count.passed}/${count.total} tests, ${count.assertsPassed} assertions`)
  const readme = read('README.md') ?? ''
  const claimed = /(\d+)\s+(?:passing\s+)?tests/i.exec(readme)
  if (claimed && Number(claimed[1]) !== count.total) {
    failures.push(`README claims ${claimed[1]} tests but the runner counts ${count.total} — fix the README`)
  } else if (claimed) {
    ok.push(`README test count (${claimed[1]}) matches the runner`)
  } else {
    warnings.push('README does not state the exact test count — judges reward the number')
  }
}

// ── video + tx-hash slots: pending is ALLOWED but must be explicit ──
const submission = read('docs/SUBMISSION.md') ?? read('SUBMISSION.md') ?? ''
if (/youtu\.?be/.test(submission)) ok.push('SUBMISSION references a YouTube link')
else warnings.push('SUBMISSION has no YouTube link yet (required ≤3-min unlisted video before the deadline)')
if (/\(pending[^)]*\)/i.test(submission)) warnings.push('SUBMISSION contains explicit (pending …) items — resolve before final submit')

// ── HTML deliverables must not ship dead placeholder links (judges click them) ──
for (const html of ['landing/index.html', 'docs/pitch/index.html']) {
  const content = read(html)
  if (content === null) continue
  if (/youtu\.?be\/PLACEHOLDER|["'(]\/PLACEHOLDER/.test(content)) {
    warnings.push(`${html} still links to youtu.be/PLACEHOLDER — replace with the real demo video URL before submitting`)
  }
}

console.log('The Treble — submission readiness\n')
for (const line of ok) console.log(`  ✓ ${line}`)
for (const line of warnings) console.log(`  ⚠ ${line}`)
for (const line of failures) console.log(`  ✗ ${line}`)
console.log('')
if (failures.length > 0) {
  console.error(`NOT READY — ${failures.length} blocking issue(s), ${warnings.length} warning(s)`)
  process.exit(1)
}
console.log(`READY${warnings.length ? ` with ${warnings.length} warning(s) — resolve before the DoraHacks deadline` : ''}`)
