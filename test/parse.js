const test = require('brittle')
const { parse, stringify, YAMLError } = require('..')

test('parses an OpenAPI document', (t) => {
  const spec = parse(`openapi: 3.1.0
info:
  title: Example
  version: '1.0'
paths:
  /chat:
    post:
      description: |-
        First line
        Second line
`)
  t.is(spec.openapi, '3.1.0')
  t.is(spec.info.version, '1.0')
  t.is(spec.paths['/chat'].post.description, 'First line\nSecond line')
})

test('resolves YAML 1.2 Core scalars', (t) => {
  t.alike(parse('[~, null, true, False, 12, -0x1A, 0o7, 1.5, .inf, -.Inf, yes, 2026-10-27, "1"]'), [
    null,
    null,
    true,
    false,
    12,
    '-0x1A',
    7,
    1.5,
    Infinity,
    -Infinity,
    'yes',
    '2026-10-27',
    '1'
  ])
  t.ok(Number.isNaN(parse('.nan')))
  t.is(parse('!!int 0b101'), 5)
  t.is(parse('!!str 12'), '12')
  t.is(parse('! 12'), '12')
  t.alike(parse('!!map'), {})
})

test('merge keys are plain keys', (t) => {
  const merged = parse('base: &base {x: 1}\ncopy: {<<: *base}')
  t.is(merged.copy.x, undefined)
  t.is(merged.copy['<<'].x, 1)
})

test('rejects invalid documents with YAMLError', (t) => {
  for (const source of [
    'x: 1\nx: 2\n',
    'a: *missing',
    'a: 1\n---\nb: 2',
    '',
    '!!js/function "function () {}"',
    '!unknown value',
    '!!str {a: 1}',
    '!!null nope',
    '? [a]\n: b',
    'a: \u0001',
    '%YAML 2.0\n---\na: 1'
  ]) {
    t.exception(() => parse(source), YAMLError, JSON.stringify(source))
  }
})

test('json option keeps the last duplicate key', (t) => {
  t.alike(parse('a: 1\na: 2', { json: true }), { a: 2 })
})

test('__proto__ stays a data key', (t) => {
  const object = parse(
    '__proto__: {yamlPolluted: true}\nconstructor: {prototype: {yamlPolluted: true}}'
  )
  t.ok(Object.hasOwn(object, '__proto__'))
  t.is(Object.getPrototypeOf(object), Object.prototype)
  t.is({}.yamlPolluted, undefined)
})

test('maxDepth limits collection nesting', (t) => {
  t.alike(parse('[[[1]]]', { maxDepth: 3 }), [[[1]]])
  t.exception(() => parse('[[[1]]]', { maxDepth: 2 }), /nesting exceeded maxDepth \(2\)/)
  t.exception(() => parse('['.repeat(100000)), /nesting exceeded maxDepth \(100\)/)
})

test('parse accepts everything stringify writes at the same maxDepth', (t) => {
  for (const maxDepth of [1, 2, 100, 500]) {
    let array = 1
    let object = 1
    for (let i = 0; i < maxDepth; i++) {
      array = [array]
      object = { a: object }
    }
    t.is(json(parse(stringify(array, { maxDepth }), { maxDepth })), json(array))
    t.is(json(parse(stringify(object, { maxDepth }), { maxDepth })), json(object))
    t.exception(() => parse(stringify([array], { maxDepth: maxDepth + 1 }), { maxDepth }))
  }
})

test('maxAliases limits alias count', (t) => {
  t.exception(() => parse('a: &a [1]\nb: *a', { maxAliases: 0 }), /maxAliases/)
})

test('maxAliasNodes bounds alias expansion', (t) => {
  let source = 'a0: &a0 [x, x, x, x, x, x, x, x, x, x]\n'
  for (let i = 1; i < 9; i++) source += `a${i}: &a${i} [${Array(10).fill(`*a${i - 1}`)}]\n`
  t.exception(() => parse(source), /maxAliasNodes \(100000\)/)
  t.exception(() => parse('a: &a [1, 2]\nb: [*a, *a]', { maxAliasNodes: 5 }), /maxAliasNodes/)
  t.alike(parse('a: &a [1, 2]\nb: [*a, *a]', { maxAliasNodes: 6 }).b, [
    [1, 2],
    [1, 2]
  ])
})

test('errors carry position and a snippet, not the source', (t) => {
  try {
    parse('secret: hunter2\nother: line\nlist: [', { filename: 'config.yml' })
    t.fail('expected an error')
  } catch (err) {
    t.ok(err instanceof YAMLError)
    t.is(err.filename, 'config.yml')
    t.is(err.line, 2)
    t.ok(err.message.includes('config.yml'))
    t.absent(err.message.includes('hunter2'))
    t.absent(JSON.stringify(err).includes('hunter2'))
  }
})

function json(value) {
  return JSON.stringify(value)
}
