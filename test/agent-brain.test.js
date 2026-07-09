import test from 'brittle'
import fs from 'fs'
import { formPickHeuristic } from '../src/agent/brains/heuristic.js'
import { SUBMIT_PICK_TOOL, buildHistory, normalizeToolArgs } from '../src/agent/brains/qvac.js'
import { formPick } from '../src/agent/pundit.js'
import { STRATEGIES, getStrategy } from '../src/agent/strategies.js'

const matches = JSON.parse(fs.readFileSync(new URL('../data/fixtures/matches.json', import.meta.url), 'utf8'))
const braArg = matches['wc2026-bra-arg']

test('strategies: registry exposes three personas with prompts', t => {
  t.alike(Object.keys(STRATEGIES).sort(), ['gaffer', 'maverick', 'professor'])
  for (const strategy of Object.values(STRATEGIES)) {
    t.ok(strategy.systemPrompt.includes('submit_pick'), `${strategy.key} prompt demands the tool call`)
    t.ok(strategy.systemPrompt.includes('not the referee'), `${strategy.key} prompt encodes no-oracle`)
  }
  t.exception(() => getStrategy('oracle'), /unknown strategy/)
})

test('heuristic: same inputs produce the identical decision (deterministic)', t => {
  const a = formPickHeuristic({ match: braArg, strategy: STRATEGIES.gaffer })
  const b = formPickHeuristic({ match: braArg, strategy: STRATEGIES.gaffer })
  t.alike(a, b)
  t.is(a.brain, 'heuristic', 'always discloses what it is')
})

test('heuristic: decisions vary across strategies or matches', t => {
  const decisions = []
  for (const strategy of Object.values(STRATEGIES)) {
    for (const match of Object.values(matches)) {
      const d = formPickHeuristic({ match, strategy })
      decisions.push(`${d.home}-${d.away}`)
    }
  }
  t.ok(new Set(decisions).size >= 3, `9 decisions span ${new Set(decisions).size} distinct scorelines`)
})

test('heuristic: outputs are always in protocol range', t => {
  for (const strategy of Object.values(STRATEGIES)) {
    for (const match of Object.values(matches)) {
      const d = formPickHeuristic({ match, strategy })
      t.ok(Number.isInteger(d.home) && d.home >= 0 && d.home <= 5, `home ${d.home}`)
      t.ok(Number.isInteger(d.away) && d.away >= 0 && d.away <= 5, `away ${d.away}`)
      t.ok(d.confidence >= 25 && d.confidence <= 92, `confidence ${d.confidence}`)
      t.ok(d.rationale.length > 0 && d.rationale.length <= 280, 'rationale fits the note limit')
    }
  }
})

test('heuristic: rationale cites the actual match context', t => {
  const d = formPickHeuristic({ match: braArg, strategy: STRATEGIES.gaffer })
  const citesNews = braArg.news.some(n => d.rationale.toLowerCase().includes(n.slice(4, 24).toLowerCase()))
  const citesTeam = d.rationale.includes('Brazil') || d.rationale.includes('Argentina') || d.rationale.includes('draw')
  t.ok(citesTeam, 'names who it is backing')
  t.ok(citesNews || d.rationale.includes('—'), 'cites a concrete signal')
})

test('heuristic: survives a bare-bones match object', t => {
  const d = formPickHeuristic({
    match: { matchId: 'mystery', home: 'A', away: 'B' },
    strategy: STRATEGIES.professor
  })
  t.ok(Number.isInteger(d.home) && Number.isInteger(d.away))
  t.ok(d.rationale.length > 0)
})

test('qvac: submit_pick tool definition matches the SDK Tool schema shape', t => {
  t.is(SUBMIT_PICK_TOOL.type, 'function')
  t.is(SUBMIT_PICK_TOOL.name, 'submit_pick')
  t.is(SUBMIT_PICK_TOOL.parameters.type, 'object')
  t.alike(SUBMIT_PICK_TOOL.parameters.required, ['home_goals', 'away_goals', 'confidence', 'rationale'])
  for (const prop of Object.values(SUBMIT_PICK_TOOL.parameters.properties)) {
    t.ok(['integer', 'string'].includes(prop.type))
  }
})

test('qvac: history primes system persona + full match context', t => {
  const history = buildHistory({ match: braArg, strategy: STRATEGIES.maverick, buyInUsdt: '20' })
  t.is(history[0].role, 'system')
  t.ok(history[0].content.includes('Maverick'))
  t.is(history[1].role, 'user')
  t.ok(history[1].content.includes('Brazil vs Argentina'))
  t.ok(history[1].content.includes('high press'))
  t.ok(history[1].content.includes('20 USD₮'))
})

test('qvac: normalizeToolArgs accepts sane calls and clamps the rest', t => {
  const good = normalizeToolArgs({ home_goals: 2, away_goals: 1, confidence: 78, rationale: 'Press beats possession.' })
  t.alike(good, { home: 2, away: 1, confidence: 78, rationale: 'Press beats possession.' })

  const clamped = normalizeToolArgs({ home_goals: 3, away_goals: 0, confidence: 400, rationale: 'x'.repeat(500) })
  t.is(clamped.confidence, 100)
  t.is(clamped.rationale.length, 280)

  const defaulted = normalizeToolArgs({ home_goals: 1, away_goals: 1, confidence: 'shrug', rationale: '   ' })
  t.is(defaulted.confidence, 50)
  t.is(defaulted.rationale, 'Backing 1-1.')
})

test('qvac: normalizeToolArgs rejects impossible scorelines', t => {
  t.exception.all(() => normalizeToolArgs({ home_goals: -1, away_goals: 0, confidence: 50, rationale: 'r' }), /bad home_goals/)
  t.exception.all(() => normalizeToolArgs({ home_goals: 1, away_goals: 2.5, confidence: 50, rationale: 'r' }), /bad away_goals/)
  t.exception.all(() => normalizeToolArgs({ home_goals: 1, away_goals: 100, confidence: 50, rationale: 'r' }), /bad away_goals/)
  t.exception.all(() => normalizeToolArgs(null), /bad home_goals/)
})

test('pundit: explicit heuristic brain and unknown brain handling', async t => {
  const d = await formPick({ match: braArg, strategy: STRATEGIES.gaffer, brain: 'heuristic' })
  t.is(d.brain, 'heuristic')
  await t.exception(formPick({ match: braArg, strategy: STRATEGIES.gaffer, brain: 'skynet' }), /unknown brain/)
})

test('pundit: auto brain falls back to DISCLOSED heuristic when qvac cannot load', async t => {
  // Force the qvac path to fail fast without a 700MB download: point the
  // model source at a file that does not exist.
  const previous = process.env.TREBLE_QVAC_MODEL
  process.env.TREBLE_QVAC_MODEL = '/nonexistent/model.gguf'
  t.teardown(() => {
    if (previous === undefined) delete process.env.TREBLE_QVAC_MODEL
    else process.env.TREBLE_QVAC_MODEL = previous
  })

  const d = await formPick({ match: braArg, strategy: STRATEGIES.gaffer, brain: 'auto', buyInUsdt: '20' })
  t.is(d.brain, 'heuristic', 'fell back')
  t.ok(d.disclosure?.includes('qvac unavailable'), 'and says so out loud')
  const again = await formPick({ match: braArg, strategy: STRATEGIES.gaffer, brain: 'auto', buyInUsdt: '20' })
  t.is(`${d.home}-${d.away}`, `${again.home}-${again.away}`, 'fallback stays deterministic')
})
