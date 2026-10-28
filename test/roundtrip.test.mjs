import test from 'brittle'
import fc from 'fast-check'
import { parse, stringify } from 'miniyaml'

test('2,000 generated JSON values round-trip', (t) => {
  t.execution(() =>
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 5 }), (value) => {
        return sameGraph(value, parse(stringify(value)))
      }),
      { numRuns: 2000, seed: 1027 }
    )
  )
})

test('2,000 generated UTF-16 strings round-trip', (t) => {
  t.execution(() =>
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 100 }), (codes) => {
        const value = String.fromCharCode(...codes)
        return parse(stringify(value)) === value
      }),
      { numRuns: 2000, seed: 1027 }
    )
  )
})

test('200 generated shared/cyclic graphs preserve identity and values', (t) => {
  let seed = 73
  const random = (size) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % size
  }
  const scalars = [null, '__proto__', -0, NaN, Infinity, 'a\n\u0085\ufffe']
  for (let sample = 0; sample < 200; sample++) {
    const graph = Array.from({ length: 20 }, (_, index) => (index % 2 ? {} : []))
    for (let index = 0; index < graph.length; index++) {
      for (let key = 0; key < 4; key++) {
        const value = random(3) ? graph[random(graph.length)] : scalars[random(scalars.length)]
        if (Array.isArray(graph[index])) graph[index].push(value)
        else {
          Object.defineProperty(graph[index], ['__proto__', 'constructor', '💬', 'key'][key], {
            value,
            enumerable: true
          })
        }
      }
    }
    t.ok(sameGraph(graph, parse(stringify(graph))), 'graph topology round-trip ' + sample)
  }
})

function sameGraph(source, result, pairs = new Map(), reverse = new Map()) {
  if (source === null || typeof source !== 'object') return Object.is(source, result)
  if (result === null || typeof result !== 'object') return false
  if (pairs.has(source)) return pairs.get(source) === result
  if (reverse.has(result)) return false
  pairs.set(source, result)
  reverse.set(result, source)
  if (Array.isArray(source) !== Array.isArray(result)) return false
  const keys = Object.keys(source)
  if (keys.length !== Object.keys(result).length) return false
  return keys.every(
    (key) => Object.hasOwn(result, key) && sameGraph(source[key], result[key], pairs, reverse)
  )
}
