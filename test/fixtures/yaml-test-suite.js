// Builds yaml-test-suite.json (MIT, see yaml-test-suite.LICENSE) from the suite's data release:
//   git clone -b data-2022-01-17 https://github.com/yaml/yaml-test-suite.git <dir>
//   node test/fixtures/yaml-test-suite.js <dir>
const fs = require('fs')
const path = require('path')

const CORE = /^(?:!|tag:yaml\.org,2002:(?:str|null|bool|int|float|seq|map))$/
const TAG = /^[+=](?:SEQ|MAP|VAL)(?: \{\}| \[\])?(?: &\S+)? <([^>]*)>/gm

const root = process.argv[2]
const cases = []

for (const dir of dirs(root)) {
  const read = (file) => {
    const name = path.join(dir, file)
    return fs.existsSync(name) ? fs.readFileSync(name, 'utf8') : null
  }
  const events = read('test.event')
  const entry = {
    id: path.relative(root, dir),
    name: read('===').trim(),
    yaml: read('in.yaml')
  }
  const documents = (events.match(/^\+DOC/gm) || []).length
  const tags = [...events.matchAll(TAG)].map((m) => m[1])

  if (read('error') !== null) entry.expect = 'error'
  else if (tags.some((tag) => !CORE.test(tag))) {
    entry.expect = 'tag'
  } // valid, outside the Core schema
  else if (documents !== 1) {
    entry.expect = 'documents'
  } // valid, not a single document
  else if (read('in.json') === null) {
    entry.expect = 'any'
  } // valid, not representable as JSON
  else {
    entry.expect = 'value'
    entry.value = JSON.parse(read('in.json'))
  }
  cases.push(entry)
}

fs.writeFileSync(
  path.join(__dirname, 'yaml-test-suite.json'),
  JSON.stringify(cases, null, 1) + '\n'
)

function dirs(dir) {
  const entries = fs.readdirSync(dir).sort()
  if (entries.includes('in.yaml')) return [dir]
  return entries
    .filter((entry) => /^[0-9A-Z]{4}$|^[0-9]{2}$/.test(entry))
    .flatMap((entry) => dirs(path.join(dir, entry)))
}
