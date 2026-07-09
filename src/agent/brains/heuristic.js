// The DISCLOSED deterministic fallback brain.
//
// This is NOT an LLM and is never presented as one: every decision it returns
// carries `brain: 'heuristic'`, and the UI/CLI/README surface that label.
// It exists so CI, the offline verifier and demo-without-a-700MB-model runs
// still exercise the full pick→stake seam, and so tests can assert exact
// outputs. Same inputs ⇒ same pick, on every machine.

import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import { stableStringify } from '../../core/canonical.js'
import { LIMITS } from '../../core/constants.js'

// Deterministic bytes from any JSON-able seed material.
function seededBytes (material) {
  return crypto.hash(b4a.from(stableStringify(material)))
}

export function formPickHeuristic ({ match, strategy }) {
  const bytes = seededBytes({ matchId: match.matchId, strategy: strategy.key })
  const roll = (i, mod) => bytes[i % bytes.length] % mod

  const ratingGap = (match.ratings?.home ?? 80) - (match.ratings?.away ?? 80)
  const formScore = side => (match.form?.[side] ?? [])
    .reduce((sum, r) => sum + (r === 'W' ? 1 : r === 'D' ? 0 : -1), 0)
  const formGap = formScore('home') - formScore('away')

  // expected goals, nudged by rating + form + persona aggression
  const edge = ratingGap * 0.08 + formGap * 0.15
  let home = Math.round(1.15 + Math.max(-1, Math.min(1.6, edge)) + strategy.aggression * (roll(3, 3) - 1) * 0.5)
  let away = Math.round(1.15 - Math.max(-1.6, Math.min(1, edge)) + strategy.aggression * (roll(7, 3) - 1) * 0.5)

  // upset persona occasionally flips the favourite — deterministically
  const upset = roll(11, 100) < strategy.upsetBias * 100
  if (upset && edge > 0.2) [home, away] = [away, home + 1]

  home = Math.max(0, Math.min(5, home))
  away = Math.max(0, Math.min(5, away))

  const gap = Math.abs(edge)
  const confidence = Math.max(25, Math.min(92, Math.round(
    42 + gap * 18 + (1 - strategy.upsetBias) * 12 + (roll(13, 9) - 4)
  )))

  const newsIndex = roll(17, Math.max(1, (match.news ?? []).length))
  const signal = match.news?.[newsIndex] ?? match.styles?.away ?? 'the run of form'
  const backed = home > away ? match.home : home < away ? match.away : 'the draw'
  let rationale = `Backing ${home}-${away} ${backed} — ${lowerFirst(signal)}`
  if (rationale.length > LIMITS.MAX_NOTE) rationale = rationale.slice(0, LIMITS.MAX_NOTE - 1) + '…'

  return {
    brain: 'heuristic',
    home,
    away,
    confidence,
    rationale,
    signals: { ratingGap, formGap, upset }
  }
}

function lowerFirst (text) {
  return text.length === 0 ? text : text[0].toLowerCase() + text.slice(1)
}
