import { parseEvents } from './parser/parser.ts'
import { construct } from './construct.ts'

export { stringify, type StringifyOptions } from './stringify.ts'
export { YAMLException } from './exception.ts'

interface ParseOptions {
  /** File path included in parsing errors. */
  filename?: string
  /** Maximum collection nesting depth, 1–500; defaults to 100. */
  maxDepth?: number
  /** Maximum alias nodes per document; -1 (default) disables the limit. */
  maxAliases?: number
  /** Maximum nodes that aliases expand to per document; defaults to 100000, -1 disables the limit. */
  maxAliasNodes?: number
  /** Allow duplicate mapping keys, keeping the last value; defaults to false. */
  json?: boolean
}

function parse(source: string, opts: ParseOptions = {}): unknown {
  const options = {
    filename: opts.filename ?? '',
    maxDepth: opts.maxDepth ?? 100,
    maxAliases: opts.maxAliases ?? -1,
    maxAliasNodes: opts.maxAliasNodes ?? 100000,
    json: opts.json ?? false
  }
  return construct(source, parseEvents(source, options), options)
}

export { parse, type ParseOptions }
