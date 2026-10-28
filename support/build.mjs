import { readFile } from 'node:fs/promises'
import { build } from 'rolldown'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

await build({
  input: 'src/index.ts',
  output: {
    file: 'lib/index.mjs',
    format: 'es',
    minify: true,
    banner: `/*! ${pkg.name} ${pkg.version} @license ${pkg.license}; includes js-yaml (MIT), see NOTICE.md */`
  }
})
