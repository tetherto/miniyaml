/* global Bare */
import test from 'brittle'
import { parse, YAMLException } from 'miniyaml'

const fs = (await import(typeof Bare === 'undefined' ? 'node:fs' : 'bare-fs')).default
const path = (await import(typeof Bare === 'undefined' ? 'node:path' : 'bare-path')).default

const suite = path.join(path.dirname(new URL(import.meta.url).pathname), 'yaml-test-suite')
const CORE = /^(?:!|tag:yaml\.org,2002:(?:str|null|bool|int|float|seq|map))$/
const EVENT_TAG = /^[+=](?:SEQ|MAP|VAL)(?: \{\}| \[\])?(?: &\S+)? <([^>]*)>/gm

for (const dir of cases(suite)) {
  const name = path.relative(suite, dir) + ' ' + read(dir, '===').trim()
  const yaml = read(dir, 'in.yaml')

  if (fs.existsSync(path.join(dir, 'error'))) {
    test(name + ' (error)', (t) => {
      t.exception(() => parse(yaml), YAMLException)
    })
    continue
  }

  const tags = [...read(dir, 'test.event').matchAll(EVENT_TAG)].map((m) => m[1])
  if (tags.some((tag) => !CORE.test(tag))) {
    test(name + ' (non-Core tag)', (t) => {
      t.exception(() => parse(yaml), YAMLException)
    })
    continue
  }

  const json = single(read(dir, 'in.json'))
  if (json === undefined) continue

  test(name, (t) => {
    t.alike(parse(yaml), json.value)
  })
}

function cases(dir) {
  const entries = fs.readdirSync(dir).sort()
  if (entries.includes('in.yaml')) return [dir]
  // name/ and tags/ index the same cases again.
  return entries
    .filter((entry) => /^[0-9A-Z]{4}$|^[0-9]{2}$/.test(entry))
    .flatMap((entry) => cases(path.join(dir, entry)))
}

function read(dir, file) {
  const name = path.join(dir, file)
  return fs.existsSync(name) ? fs.readFileSync(name, 'utf8') : ''
}

// Only single-document streams have a single expected value.
function single(text) {
  if (text.trim() === '') return undefined
  try {
    return { value: JSON.parse(text) }
  } catch {
    return undefined
  }
}
