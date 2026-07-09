// USD₮ money math. All amounts are integer micro-USD₮ (1 USD₮ = 1_000_000 µ).
// Floats never touch consensus state.

export const MICRO = 1_000_000

export function isMicroAmount (value) {
  return Number.isSafeInteger(value) && value >= 0
}

export function assertMicro (value, what = 'amount') {
  if (!isMicroAmount(value)) {
    throw new TypeError(`${what} must be a non-negative safe integer of micro-USD₮, got ${value}`)
  }
  return value
}

// '20', '20.5', 20, 20.5 -> 20500000. Rejects >6 decimals and unsafe values.
export function toMicro (usdt) {
  const str = String(usdt).trim()
  if (!/^\d+(\.\d{1,6})?$/.test(str)) {
    throw new TypeError(`invalid USD₮ amount: ${usdt}`)
  }
  const [whole, frac = ''] = str.split('.')
  const micro = Number(whole) * MICRO + Number(frac.padEnd(6, '0'))
  return assertMicro(micro)
}

export function fromMicro (micro) {
  assertMicro(micro)
  const whole = Math.floor(micro / MICRO)
  const frac = micro % MICRO
  if (frac === 0) return String(whole)
  return `${whole}.${String(frac).padStart(6, '0').replace(/0+$/, '')}`
}

export function fmtUsdt (micro) {
  return `${fromMicro(micro)} USD₮`
}
