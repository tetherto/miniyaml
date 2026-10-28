const test = require('brittle')
const { parse, stringify } = require('..')

test('2,000 generated values round-trip', (t) => {
  const random = rng(1027)
  for (let i = 0; i < 2000; i++) {
    const value = generate(random, 4)
    const text = stringify(value)
    if (!same(parse(text), value)) {
      t.fail('round-trip ' + JSON.stringify(text))
      return
    }
  }
  t.pass()
})

test('2,000 generated UTF-16 strings round-trip', (t) => {
  const random = rng(1027)
  for (let i = 0; i < 2000; i++) {
    const codes = Array.from({ length: random(40) }, () => random(0x10000))
    const value = String.fromCharCode(...codes)
    if (
      parse(stringify(value)) !== value ||
      parse(stringify({ [value]: value }))[value] !== value
    ) {
      t.fail('round-trip ' + JSON.stringify(value))
      return
    }
  }
  t.pass()
})

test('200 generated shared and cyclic graphs keep identity', (t) => {
  const random = rng(73)
  const scalars = [null, '__proto__', -0, NaN, Infinity, 'a\n\u0085\ufffe', '- x', 'k: v']
  for (let sample = 0; sample < 200; sample++) {
    const graph = Array.from({ length: 20 }, (_, i) => (i % 2 ? {} : []))
    for (const node of graph) {
      for (let key = 0; key < 4; key++) {
        const value = random(3) ? graph[random(graph.length)] : scalars[random(scalars.length)]
        if (Array.isArray(node)) node.push(value)
        else {
          Object.defineProperty(node, ['__proto__', 'constructor', '💬', 'key'][key], {
            value,
            enumerable: true
          })
        }
      }
    }
    if (!same(parse(stringify(graph)), graph)) {
      t.fail('graph ' + sample)
      return
    }
  }
  t.pass()
})

const WORDS = ['', ' ', 'a', 'null', 'True', '~', '1', '-1.5e3', '0x1F', '.inf', '.NaN', 'yes']
const PIECES = [
  'a',
  ' ',
  ':',
  '#',
  '-',
  '?',
  '"',
  "'",
  '\\',
  '\n',
  '\t',
  '[',
  '}',
  ',',
  '&',
  '*',
  '!',
  '|',
  '>',
  '%',
  '@',
  '`',
  'é',
  '\u2028',
  '\x85',
  '...',
  '---'
]

function generate(random, depth) {
  const kind = random(depth > 0 ? 8 : 5)
  if (kind === 0) return null
  if (kind === 1) return random(2) === 0
  if (kind === 2) return [0, -0, 1, -7, 3.25, 1e21, 5e-324, Infinity, -Infinity, NaN][random(10)]
  if (kind === 3) return WORDS[random(WORDS.length)]
  if (kind === 4) {
    let text = ''
    for (let i = random(6); i > 0; i--) text += PIECES[random(PIECES.length)]
    return text
  }
  if (kind === 5) return Array.from({ length: random(4) }, () => generate(random, depth - 1))
  const object = {}
  for (let i = random(4); i > 0; i--) object[generate(random, 0) + ''] = generate(random, depth - 1)
  return object
}

function rng(seed) {
  return (size) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % size
  }
}

function same(result, source, pairs = new Map()) {
  if (source === null || typeof source !== 'object') return Object.is(source, result)
  if (result === null || typeof result !== 'object') return false
  if (pairs.has(source)) return pairs.get(source) === result
  pairs.set(source, result)
  if (Array.isArray(source) !== Array.isArray(result)) return false
  const keys = Object.keys(source)
  if (keys.length !== Object.keys(result).length) return false
  return keys.every((key) => Object.hasOwn(result, key) && same(result[key], source[key], pairs))
}
