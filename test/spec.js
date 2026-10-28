const test = require('brittle')
const { parse, YAMLError } = require('..')
const cases = require('./fixtures/yaml-test-suite.json')

for (const { id, name, yaml, expect, value } of cases) {
  test(id + ' ' + name, (t) => {
    if (expect === 'error') t.exception(() => parse(yaml), YAMLError)
    else if (expect === 'value') t.alike(parse(yaml), value)
    else t.execution(() => runOrYAMLError(yaml))
  })
}

function runOrYAMLError(yaml) {
  try {
    parse(yaml)
  } catch (err) {
    if (!(err instanceof YAMLError)) throw err
  }
}
