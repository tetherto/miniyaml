import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.join(process.cwd(), 'package.json'))
const args = process.argv.slice(2)
const values = (flag) => args.flatMap((arg, i) => (arg === flag ? [args[i + 1]] : []))
const value = (flag, fallback) => values(flag).at(-1) ?? fallback
if (args.includes('--help')) {
  console.log(
    'node benchmark.mjs [--library file] [--compare name=file] [--reference file] [--fixture file.yaml] [--runtime node-or-bare-binary] [--output results.json] [--rounds 7] [--batch-ms 100]'
  )
  process.exit(0)
}
const resolve = (entry) =>
  entry.startsWith('.') || path.isAbsolute(entry) ? path.resolve(entry) : require.resolve(entry)
const library = resolve(value('--library', path.join(here, '../lib/index.mjs')))
const entries = [
  ['miniyaml', library],
  ...values('--compare').map((spec) => {
    const equals = spec.indexOf('=')
    if (equals < 1) throw new Error('Use --compare name=module-or-path')
    return [spec.slice(0, equals), resolve(spec.slice(equals + 1))]
  })
]
const referencePath = resolve(value('--reference', library))
const referenceModule = await import(pathToFileURL(referencePath).href)
const parseReference =
  referenceModule.parse ??
  ((text) =>
    referenceModule.load(
      text,
      referenceModule.CORE_SCHEMA ? { schema: referenceModule.CORE_SCHEMA } : undefined
    ))
const stringifyReference =
  referenceModule.stringify ??
  ((data) =>
    referenceModule.dump(
      data,
      referenceModule.CORE_SCHEMA ? { schema: referenceModule.CORE_SCHEMA } : undefined
    ))
const generated = {
  records: Array.from({ length: 3000 }, (_, i) => ({
    id: i,
    name: `record ${i}`,
    enabled: i % 3 === 0,
    score: i / 7,
    description: `Record ${i}: Unicode café ✓ with "quoted" text\nand a second line`,
    tags: ['alpha', 'beta', `group-${i % 25}`],
    metadata: { owner: `team-${i % 12}`, optional: null, counts: [i, i + 1, i + 2] }
  }))
}
const fixtures = ['benchmark.yaml', 'openapi-mini.yaml', 'config-rich.yaml'].map((name) => ({
  name,
  text: fs.readFileSync(path.join(here, 'fixtures', name), 'utf8')
}))
fixtures.push({ name: 'generated-data', text: stringifyReference(generated), expected: generated })
for (const file of values('--fixture')) {
  fixtures.push({ name: path.basename(file), text: fs.readFileSync(file, 'utf8') })
}
for (const fixture of fixtures) fixture.expected ??= parseReference(fixture.text)
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex')
const options = {
  rounds: Number(value('--rounds', '7')),
  batchMs: Number(value('--batch-ms', '100'))
}
if (
  !Number.isInteger(options.rounds) ||
  options.rounds < 3 ||
  options.rounds > 99 ||
  !Number.isFinite(options.batchMs) ||
  options.batchMs < 50 ||
  options.batchMs > 10000
) {
  throw new Error('Use 3–99 rounds and a 50–10000ms batch target')
}
const metadata = {
  recordedAt: new Date().toISOString(),
  reference: referencePath,
  host: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model },
  modules: entries.map(([name, file]) => ({
    name,
    file,
    entrySha256: hash(fs.readFileSync(file))
  })),
  fixtures: fixtures.map(({ name, text }) => ({
    name,
    bytes: Buffer.byteLength(text),
    sha256: hash(text)
  })),
  options
}
const worker = fs.readFileSync(path.join(here, 'worker.mjs'), 'utf8')
const imports = entries
  .map(
    ([name, file], i) => `import * as module${i} from ${JSON.stringify(pathToFileURL(file).href)};`
  )
  .join('\n')
const source = `${imports}\nimport * as referenceModule from ${JSON.stringify(pathToFileURL(referencePath).href)};\nconst modules=[${entries.map(([name], i) => `{name:${JSON.stringify(name)},module:module${i}}`).join(',')}];\nconst fixtures=${JSON.stringify(fixtures)};\nconst metadata=${JSON.stringify(metadata)};\n${worker}`
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'miniyaml-benchmark-'))
try {
  const file = path.join(scratch, 'run.mjs')
  fs.writeFileSync(file, source)
  const result = spawnSync(value('--runtime', process.execPath), [file], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Benchmark runtime exited ${result.status}: ${result.stdout}`)
  }
  const report = JSON.parse(result.stdout)
  const output = value('--output', '')
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}
