/* global referenceModule, fixtures, metadata, modules, Bare */
// The Node orchestrator supplies imports, fixtures and metadata. This body uses
// no filesystem or Node-specific APIs, so it also executes in Bare.
const normalize = (namespace) => {
  const module = namespace.parse || namespace.load ? namespace : namespace.default
  return {
    parse:
      module.parse ??
      ((text) =>
        module.load(text, module.CORE_SCHEMA ? { schema: module.CORE_SCHEMA } : undefined)),
    stringify:
      module.stringify ??
      ((data) => module.dump(data, module.CORE_SCHEMA ? { schema: module.CORE_SCHEMA } : undefined))
  }
}
const reference = normalize(referenceModule)
const canonical = (value) =>
  value === null || typeof value !== 'object'
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? '[' + value.map(canonical).join(',') + ']'
      : '{' +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
          .join(',') +
        '}'
const byteLength = (text) => {
  let size = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    size += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return size
}
const median = (samples) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]
let sink = 0
function measure(fn, iterations) {
  const start = Date.now()
  for (let i = 0; i < iterations; i++) {
    const value = fn()
    sink ^= typeof value === 'string' ? value.length : value === null ? 0 : 1
  }
  return Date.now() - start
}
const results = []
for (const fixture of fixtures) {
  const expected = canonical(fixture.expected)
  const cases = []
  for (const { name, module } of modules) {
    const lib = normalize(module)
    for (const operation of ['parse', 'stringify']) {
      const row = { library: name, fixture: fixture.name, operation }
      results.push(row)
      try {
        let actual
        if (operation === 'parse') actual = lib.parse(fixture.text)
        else {
          const output = lib.stringify(fixture.expected)
          actual = reference.parse(output)
          row.outputBytes = byteLength(output)
        }
        if (canonical(actual) !== expected) throw new Error('Semantic value mismatch')
        row.correct = true
      } catch (error) {
        row.correct = false
        row.error = error.message
        continue
      }
      const fn =
        operation === 'parse'
          ? () => lib.parse(fixture.text)
          : () => lib.stringify(fixture.expected)
      let iterations = 1
      let elapsed
      do {
        elapsed = measure(fn, iterations)
        if (elapsed < metadata.options.batchMs) iterations *= 2
      } while (elapsed < metadata.options.batchMs && iterations < 65536)
      iterations = Math.max(
        1,
        Math.round((iterations * metadata.options.batchMs) / Math.max(elapsed, 1))
      )
      cases.push({ row, fn, iterations, samples: [] })
    }
  }
  for (let round = 0; round < metadata.options.rounds; round++) {
    for (let offset = 0; offset < cases.length; offset++) {
      const test = cases[(round + offset) % cases.length]
      test.samples.push(measure(test.fn, test.iterations) / test.iterations)
    }
  }
  for (const test of cases) {
    Object.assign(test.row, {
      iterations: test.iterations,
      samplesMs: test.samples,
      medianMs: median(test.samples),
      minMs: Math.min(...test.samples),
      maxMs: Math.max(...test.samples)
    })
  }
  console.error('Measured ' + fixture.name)
}
console.log(
  JSON.stringify({
    ...metadata,
    runtime: typeof Bare === 'undefined' ? 'Node ' + process.version : 'Bare ' + Bare.version,
    sink,
    results
  })
)
