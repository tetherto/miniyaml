export interface ParseOptions {
  /** File name included in error messages. */
  filename?: string
  /** Maximum collection nesting depth, 1–500. Defaults to 100. */
  maxDepth?: number
  /** Maximum aliases per document. Defaults to -1, no limit. */
  maxAliases?: number
  /** Maximum nodes that aliases expand to per document. Defaults to 100000; -1 for no limit. */
  maxAliasNodes?: number
  /** Allow duplicate mapping keys, keeping the last value. Defaults to false. */
  json?: boolean
}

export interface StringifyOptions {
  /** Spaces per indentation level, 1–10. Defaults to 2. */
  indent?: number
  /** Maximum collection nesting depth, 1–500. Defaults to 100. */
  maxDepth?: number
}

export class YAMLError extends Error {
  reason: string
  filename: string
  position: number
  line: number
  column: number
}

export function parse(source: string, options?: ParseOptions): unknown
export function stringify(value: unknown, options?: StringifyOptions): string
