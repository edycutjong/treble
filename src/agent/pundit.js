// Brain selector. `auto` tries the real on-device QVAC model and falls back
// to the disclosed heuristic if the model/runtime is unavailable — the
// fallback is always visibly labeled, never silently passed off as the LLM.

import { formPickHeuristic } from './brains/heuristic.js'
import { formPickQvac } from './brains/qvac.js'

export async function formPick ({ match, strategy, brain = 'auto', buyInUsdt, onToken, onProgress }) {
  if (brain === 'heuristic') {
    return formPickHeuristic({ match, strategy })
  }
  if (brain === 'qvac') {
    return formPickQvac({ match, strategy, buyInUsdt, onToken, onProgress })
  }
  if (brain !== 'auto') {
    throw new Error(`unknown brain "${brain}" — use auto | qvac | heuristic`)
  }
  try {
    return await formPickQvac({ match, strategy, buyInUsdt, onToken, onProgress })
  } catch (err) {
    const fallback = formPickHeuristic({ match, strategy })
    fallback.disclosure = `qvac unavailable (${truncate(err.message, 90)}) — deterministic heuristic used and disclosed`
    return fallback
  }
}

function truncate (text, max) {
  const clean = String(text).replace(/\s+/g, ' ')
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean
}
