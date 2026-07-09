import test from 'brittle'
import { MICRO, toMicro, fromMicro, fmtUsdt, isMicroAmount, assertMicro } from '../src/core/money.js'

test('money: MICRO is one million', t => {
  t.is(MICRO, 1_000_000)
})

test('money: toMicro parses whole USD₮', t => {
  t.is(toMicro('20'), 20_000_000)
  t.is(toMicro(20), 20_000_000)
  t.is(toMicro('0'), 0)
})

test('money: toMicro parses fractional USD₮', t => {
  t.is(toMicro('20.5'), 20_500_000)
  t.is(toMicro('0.000001'), 1)
  t.is(toMicro('1.25'), 1_250_000)
})

test('money: toMicro rejects more than 6 decimals', t => {
  t.exception.all(() => toMicro('1.0000001'))
})

test('money: toMicro rejects negative, junk and float artefacts', t => {
  t.exception.all(() => toMicro('-5'))
  t.exception.all(() => toMicro('abc'))
  t.exception.all(() => toMicro('1e3'))
  t.exception.all(() => toMicro(''))
  t.exception.all(() => toMicro('1.'))
})

test('money: fromMicro round-trips', t => {
  t.is(fromMicro(20_000_000), '20')
  t.is(fromMicro(20_500_000), '20.5')
  t.is(fromMicro(1), '0.000001')
  t.is(fromMicro(0), '0')
})

test('money: round-trip stability across values', t => {
  for (const v of ['0.000001', '0.1', '1', '19.99', '250', '9999.123456']) {
    t.is(fromMicro(toMicro(v)), v, `round-trip ${v}`)
  }
})

test('money: fmtUsdt appends the symbol', t => {
  t.is(fmtUsdt(20_000_000), '20 USD₮')
})

test('money: isMicroAmount guards integers only', t => {
  t.ok(isMicroAmount(0))
  t.ok(isMicroAmount(20_000_000))
  t.absent(isMicroAmount(-1))
  t.absent(isMicroAmount(1.5))
  t.absent(isMicroAmount(Number.MAX_SAFE_INTEGER + 1))
  t.absent(isMicroAmount('20'))
  t.absent(isMicroAmount(NaN))
})

test('money: assertMicro throws with context', t => {
  t.exception.all(() => assertMicro(-1, 'stake'), /stake/)
  t.is(assertMicro(5), 5)
})
