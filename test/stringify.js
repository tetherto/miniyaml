const test = require('brittle')
const { parse, stringify } = require('..')

test('writes block collections, quoting only where needed', (t) => {
  t.is(
    stringify({ a: [1, { b: 'x' }], c: {}, d: [], e: 'true', f: 'a: b', 1: 'é ✓' }),
    '"1": é ✓\na:\n  - 1\n  -\n    b: x\nc: {}\nd: []\ne: "true"\nf: "a: b"\n'
  )
  t.is(stringify({ a: [1] }, { indent: 4 }), 'a:\n    - 1\n')
})

test('round-trips scalars', (t) => {
  for (const text of [' foo\nbar\nbaz ', 'a: b', 'true', '2026-10-27', '', '\n']) {
    t.is(parse(stringify(text)), text, JSON.stringify(text))
  }
  for (const text of ['\u007f\u0085\u009f', '\u2028\u2029', '￾￿', '\ud800', '\udc00']) {
    t.is(parse(stringify(text)), text, 'Unicode ' + JSON.stringify(text))
  }
  for (const value of [NaN, Infinity, -Infinity, -0, 1e21, 5e-324]) {
    t.ok(Object.is(parse(stringify(value)), value), String(value))
  }
})

test('rejects unsupported data', (t) => {
  for (const value of [
    new Date(),
    new Map(),
    new Set(),
    new Uint8Array(),
    undefined,
    () => {},
    Symbol('unsupported'),
    1n,
    Array(2),
    { a: undefined }
  ]) {
    t.exception.all(() => stringify(value), String(value))
  }
})

test('rejects accessors without invoking them', (t) => {
  let calls = 0
  const object = {
    get value() {
      calls++
      return 1
    }
  }
  const array = [1]
  Object.defineProperty(array, '0', {
    get() {
      calls++
      return 1
    }
  })
  t.exception.all(() => stringify(object))
  t.exception.all(() => stringify(array))
  t.is(calls, 0)
})

test('maxDepth limits collection nesting', (t) => {
  let deep = {}
  for (let i = 0; i < 100; i++) deep = { next: deep }
  t.exception.all(() => stringify(deep), /maxDepth \(100\)/)
  t.ok(stringify(deep, { maxDepth: 101 }))
})

test('prototype keys stay data', (t) => {
  const restored = parse(stringify(JSON.parse('{"__proto__":{"x":1},"constructor":2}')))
  t.ok(Object.hasOwn(restored, '__proto__'))
  t.is(Object.getOwnPropertyDescriptor(restored, '__proto__').value.x, 1)
  t.is(restored.constructor, 2)
})

test('shared and cyclic references become anchors and aliases', (t) => {
  const shared = { text: 'shared' }
  t.is(stringify({ a: shared, b: shared }), 'a: &a0\n  text: shared\nb: *a0\n')
  const restored = parse(stringify({ a: shared, b: shared }))
  t.is(restored.a, restored.b)
  const cycle = {}
  cycle.self = cycle
  const restoredCycle = parse(stringify(cycle))
  t.is(restoredCycle.self, restoredCycle)
})
