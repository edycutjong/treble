// The REAL on-device brain: @qvac/sdk completion() with tool-calling.
//
// The model reasons about the match locally (zero cloud calls) and must
// commit by calling submit_pick — the SAME decision boundary the heuristic
// fallback uses, so the seat code upstream cannot tell the brains apart
// except by the disclosed `brain` label.
//
// The model is NOT loaded at import time (first use downloads ~1 GB).
// Default model: QWEN3_1_7B_INST_Q4 — chosen over the smaller Llama 3.2 1B
// because tool-calling reliability was verified empirically on-device
// (Qwen3 1.7B emits well-formed submit_pick calls; 1B-class models tended to
// narrate prose instead). `TREBLE_QVAC_MODEL` overrides the source
// (a local GGUF path, an HTTPS URL, or a pear:// model link).

import { LIMITS } from '../../core/constants.js'

export const SUBMIT_PICK_TOOL = {
  type: 'function',
  name: 'submit_pick',
  description: 'Lock in your final prediction for this match. Call exactly once, after weighing the context.',
  parameters: {
    type: 'object',
    properties: {
      home_goals: { type: 'integer', description: 'Goals for the home side (0-9)' },
      away_goals: { type: 'integer', description: 'Goals for the away side (0-9)' },
      confidence: { type: 'integer', description: 'Your confidence in this exact scoreline, 0-100' },
      rationale: { type: 'string', description: 'One punchy line (max 200 chars) citing a concrete tactical or statistical reason' }
    },
    required: ['home_goals', 'away_goals', 'confidence', 'rationale']
  }
}

export function buildHistory ({ match, strategy, buyInUsdt }) {
  return [
    { role: 'system', content: strategy.systemPrompt },
    {
      role: 'user',
      content: [
        `Match: ${match.home} vs ${match.away} — ${match.competition ?? 'friendly'} at ${match.venue ?? 'TBD'}.`,
        `Ratings: ${match.home} ${match.ratings?.home}, ${match.away} ${match.ratings?.away}.`,
        `Form (last 5): ${match.home} ${match.form?.home?.join('')}, ${match.away} ${match.form?.away?.join('')}.`,
        `Styles: ${match.home} — ${match.styles?.home}; ${match.away} — ${match.styles?.away}.`,
        `News: ${(match.news ?? []).join(' | ')}.`,
        `Head-to-head: ${match.h2h ?? 'n/a'}.`,
        `The pot buy-in is ${buyInUsdt} USD₮ from your own wallet (a Transaction Policy caps you).`,
        'Decide now: call submit_pick exactly once with your final exact score.'
      ].join('\n')
    }
  ]
}

// Validates and normalizes raw tool-call arguments from the model.
export function normalizeToolArgs (args) {
  const home = Number(args?.home_goals)
  const away = Number(args?.away_goals)
  if (!Number.isInteger(home) || home < 0 || home > LIMITS.MAX_GOALS) throw new Error(`model returned bad home_goals: ${args?.home_goals}`)
  if (!Number.isInteger(away) || away < 0 || away > LIMITS.MAX_GOALS) throw new Error(`model returned bad away_goals: ${args?.away_goals}`)
  let confidence = Number(args?.confidence)
  if (!Number.isFinite(confidence)) confidence = 50
  confidence = Math.max(0, Math.min(100, Math.round(confidence)))
  let rationale = String(args?.rationale ?? '').trim().replace(/\s+/g, ' ')
  if (rationale.length === 0) rationale = `Backing ${home}-${away}.`
  if (rationale.length > LIMITS.MAX_NOTE) rationale = rationale.slice(0, LIMITS.MAX_NOTE - 1) + '…'
  return { home, away, confidence, rationale }
}

export async function formPickQvac ({ match, strategy, buyInUsdt, onToken = null, onProgress = null }) {
  // A bare `TREBLE_QVAC_MODEL` path/URL is a plain string with no engine
  // metadata, so the SDK can't infer the addon — it needs an explicit
  // modelType. The built-in constants already carry that metadata.
  const override = process.env.TREBLE_QVAC_MODEL
  // A local-path override must exist — fail fast, BEFORE importing the heavy SDK
  // (and let the `auto` brain fall back to the disclosed heuristic) rather than
  // hand the SDK a dead path it would try to resolve/download for a long time.
  // URLs / registry sources (no leading `/` or `.`) are left for the SDK.
  if (typeof override === 'string' && (override.startsWith('/') || override.startsWith('.'))) {
    try {
      const { existsSync } = await import('node:fs')
      if (!existsSync(override)) throw new Error(`TREBLE_QVAC_MODEL points at a missing GGUF: ${override}`)
    } catch (e) {
      if (String(e?.message).includes('missing GGUF')) throw e
      // fs unavailable (e.g. Bare runtime) — skip the pre-check, let the SDK resolve it
    }
  }
  /* c8 ignore start -- live @qvac/sdk on-device model: dynamic import + loadModel/completion/tokenStream/toolCallStream/unloadModel require the ~1GB QWEN3 GGUF and the optional native addon; exercised on-device only, never mocked (project honesty rule) */
  const sdk = await import('@qvac/sdk')
  const modelId = await sdk.loadModel({
    modelSrc: override ?? sdk.QWEN3_1_7B_INST_Q4 ?? sdk.LLAMA_3_2_1B_INST_Q4_0,
    ...(typeof override === 'string' ? { modelType: 'llamacpp-completion' } : {}),
    // `tools: true` is REQUIRED — without it the addon disables the tool
    // grammar entirely and the model just narrates prose (never emits a
    // structured submit_pick). ctx_size matches the SDK's own tool example.
    modelConfig: { ctx_size: 4096, tools: true },
    onProgress: onProgress ?? undefined
  })

  try {
    const run = sdk.completion({
      modelId,
      history: buildHistory({ match, strategy, buyInUsdt }),
      stream: true,
      tools: [SUBMIT_PICK_TOOL]
    })

    // Stream the narration tokens (chain-of-thought + rationale) for the UI.
    // ALWAYS drain tokenStream (even with no onToken): leaving it undrained can
    // backpressure-stall the tool-call stream. A narration hiccup must never
    // lose an otherwise-valid pick, so swallow its errors here.
    const narrate = (async () => {
      try {
        for await (const tok of run.tokenStream) { if (onToken) onToken(tok) }
      } catch { /* narration is best-effort; the pick comes from toolCallStream */ }
    })()
    // …and consume the dedicated tool-call channel, which is where the SDK
    // surfaces the parsed submit_pick (the plain event stream does not emit it).
    let call = null
    for await (const evt of run.toolCallStream) {
      if (evt.call?.name === 'submit_pick' && !call) call = evt.call
    }
    await narrate
    if (!call) {
      const toolCalls = await run.toolCalls
      call = (toolCalls ?? []).find(c => c.name === 'submit_pick') ?? null
    }
    if (!call) throw new Error('the model never called submit_pick')

    return { brain: 'qvac', ...normalizeToolArgs(call.arguments) }
  } finally {
    await sdk.unloadModel({ modelId }).catch(() => {})
  }
  /* c8 ignore stop */
}
