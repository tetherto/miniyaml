import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const COMMIT = '6e6c296ae9c9d2d5c4134b4b64d01b29ac19ff6f' // tag data-2022-01-17
const dir = fileURLToPath(new URL('../test/yaml-test-suite', import.meta.url))
const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'inherit' })

if (!existsSync(dir + '/.git')) {
  execFileSync('git', ['init', '-q', dir])
  git('fetch', '-q', '--depth', '1', 'https://github.com/yaml/yaml-test-suite.git', COMMIT)
  git('checkout', '-q', '--detach', 'FETCH_HEAD')
}
