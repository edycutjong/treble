// Branch/edge coverage for the pundit's brains and dispatch: the deterministic
// heuristic's persona/formatting corners, the QVAC adapter's PURE helpers and
// fail-fast model-path guards (the live model calls are c8-ignored, never
// mocked), and the strategy registry.

import test from 'brittle'
import fs from 'fs'
import { formPickHeuristic } from '../src/agent/brains/heuristic.js'
import { buildHistory, normalizeToolArgs, formPickQvac } from '../src/agent/brains/qvac.js'
import { formPick } from '../src/agent/pundit.js'
import { STRATEGIES, getStrategy } from '../src/agent/strategies.js'

const matches = JSON.parse(fs.readFileSync(new URL('../data/fixtures/matches.json', import.meta.url), 'utf8'))
const braArg = matches['wc2026-bra-arg']

// ── strategies.js ───────────────────────────────────────────────────────────

test('strategies: getStrategy returns the persona and defaults to the Gaffer', t => {
  t.is(getStrategy('professor').key, 'professor')
  t.is(getStrategy('maverick').name, 'The Maverick')
  t.is(getStrategy().key, 'gaffer', 'no argument ⇒ the Gaffer')
})

// ── heuristic.js corner branches ────────────────────────────────────────────

test('heuristic: an upset persona deterministically flips a strong favourite (L35)', t => {
  // clear home favourite (edge ≫ 0.2) + the high-upset Maverick; scan matchIds
  // until the deterministic upset roll fires so the flip branch is exercised
  const base = { home: 'Foo', away: 'Bar', ratings: { home: 95, away: 72 } }
  let flipped = null
  for (let i = 0; i < 400 && !flipped; i++) {
    const d = formPickHeuristic({ match: { ...base, matchId: `upset-${i}` }, strategy: STRATEGIES.maverick })
    if (d.signals.upset) flipped = d
  }
  t.ok(flipped, 'found a matchId where the upset branch fires')
  t.is(flipped.signals.upset, true)
})

test('heuristic: signal falls back to styles, then to a generic phrase (L46)', t => {
  const styled = formPickHeuristic({
    match: { matchId: 'no-news-styled', home: 'A', away: 'B', styles: { away: 'parking the bus' } },
    strategy: STRATEGIES.gaffer
  })
  t.ok(styled.rationale.toLowerCase().includes('parking the bus'), 'uses styles.away when news is absent')

  const barebones = formPickHeuristic({ match: { matchId: 'nothing-at-all', home: 'A', away: 'B' }, strategy: STRATEGIES.gaffer })
  t.ok(barebones.rationale.includes('the run of form'), 'uses the generic phrase when styles is absent too')
})

test('heuristic: rationale backs the home side, the away side and the draw (L47)', t => {
  let homeWin = null
  for (let i = 0; i < 400 && !homeWin; i++) {
    const d = formPickHeuristic({ match: { matchId: `home-${i}`, home: 'A', away: 'B', ratings: { home: 96, away: 68 } }, strategy: STRATEGIES.professor })
    if (d.home > d.away) homeWin = d
  }
  t.ok(homeWin, 'found a home-favoured call')
  t.ok(homeWin.rationale.includes(' A '), 'names the home team it backs')

  const away = formPickHeuristic({
    match: { matchId: 'away-fav', home: 'A', away: 'B', ratings: { home: 68, away: 96 } },
    strategy: STRATEGIES.professor
  })
  t.ok(away.home < away.away, 'the model backs the far stronger away side')
  t.ok(away.rationale.includes(' B '), 'and names the away team')

  let draw = null
  for (let i = 0; i < 400 && !draw; i++) {
    const d = formPickHeuristic({ match: { matchId: `level-${i}`, home: 'A', away: 'B', ratings: { home: 80, away: 80 } }, strategy: STRATEGIES.professor })
    if (d.home === d.away) draw = d
  }
  t.ok(draw, 'found a level call')
  t.ok(draw.rationale.includes('the draw'), 'backs "the draw" on a level scoreline')
})

test('heuristic: an over-long signal truncates the rationale to the note limit (L49)', t => {
  const d = formPickHeuristic({
    match: { matchId: 'verbose', home: 'A', away: 'B', news: ['x'.repeat(400)] },
    strategy: STRATEGIES.gaffer
  })
  t.is(d.rationale.length, 280, 'clamped to MAX_NOTE')
  t.ok(d.rationale.endsWith('…'))
})

test('heuristic: an empty-string signal is handled by lowerFirst (L62)', t => {
  const d = formPickHeuristic({
    match: { matchId: 'blank-news', home: 'A', away: 'B', news: [''] },
    strategy: STRATEGIES.gaffer
  })
  t.ok(d.rationale.startsWith('Backing '), 'still forms a rationale with an empty signal')
})

// ── qvac.js pure helpers + fail-fast model-path guards ──────────────────────

test('qvac: buildHistory fills every field, falling back cleanly on a sparse match (L39/43/44)', t => {
  const history = buildHistory({ match: { matchId: 'sparse', home: 'A', away: 'B' }, strategy: STRATEGIES.gaffer, buyInUsdt: '20' })
  const user = history[1].content
  t.ok(user.includes('friendly'), 'competition falls back to "friendly"')
  t.ok(user.includes('at TBD'), 'venue falls back to "TBD"')
  t.ok(user.includes('Styles: A — undefined'), 'styles render even when the field is absent')
})

test('qvac: normalizeToolArgs defaults a totally missing rationale (L61)', t => {
  const out = normalizeToolArgs({ home_goals: 2, away_goals: 0, confidence: 60 }) // no rationale key at all
  t.is(out.rationale, 'Backing 2-0.')
})

test('qvac: a relative model path that does not exist fails fast (L78 dot-branch)', async t => {
  const previous = process.env.TREBLE_QVAC_MODEL
  process.env.TREBLE_QVAC_MODEL = './definitely-not-a-real-model.gguf'
  t.teardown(() => {
    if (previous === undefined) delete process.env.TREBLE_QVAC_MODEL
    else process.env.TREBLE_QVAC_MODEL = previous
  })
  await t.exception(formPickQvac({ match: braArg, strategy: STRATEGIES.gaffer, buyInUsdt: '20' }), /missing GGUF/)
})

// ── pundit.js dispatch ──────────────────────────────────────────────────────

test('pundit: the explicit qvac brain surfaces a load failure (no silent fallback)', async t => {
  // brain:'qvac' (unlike 'auto') must propagate the error; point the model at a
  // missing GGUF so the SDK fails BEFORE any download and never falls back
  const previous = process.env.TREBLE_QVAC_MODEL
  process.env.TREBLE_QVAC_MODEL = '/nonexistent/treble-model.gguf'
  t.teardown(() => {
    if (previous === undefined) delete process.env.TREBLE_QVAC_MODEL
    else process.env.TREBLE_QVAC_MODEL = previous
  })
  await t.exception(formPick({ match: braArg, strategy: STRATEGIES.gaffer, brain: 'qvac', buyInUsdt: '20' }), /missing GGUF/)
})

test('pundit: a long qvac failure message is truncated in the disclosure (truncate L29)', async t => {
  const previous = process.env.TREBLE_QVAC_MODEL
  process.env.TREBLE_QVAC_MODEL = '/nonexistent/' + 'x'.repeat(120) + '.gguf' // > 90 chars ⇒ must truncate
  t.teardown(() => {
    if (previous === undefined) delete process.env.TREBLE_QVAC_MODEL
    else process.env.TREBLE_QVAC_MODEL = previous
  })
  const d = await formPick({ match: braArg, strategy: STRATEGIES.gaffer, brain: 'auto', buyInUsdt: '20' })
  t.is(d.brain, 'heuristic', 'auto fell back to the disclosed heuristic')
  t.ok(d.disclosure.includes('…'), 'the long failure message was truncated in the disclosure')
})
