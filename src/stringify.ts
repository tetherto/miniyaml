interface StringifyOptions {
  /** Spaces per indentation level, 1–10. Defaults to 2. */
  indent?: number
  /** Maximum collection depth, 1–500. Defaults to 100. */
  maxDepth?: number
}

type Collection = unknown[] | Record<string, unknown>
interface Reference {
  count: number
  anchor: number
  emitted: boolean
}

function isCollection(value: unknown): value is Collection {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return true
  const prototype = Object.getPrototypeOf(value)
  if (prototype === Object.prototype || prototype === null) return true
  throw new TypeError('stringify supports only plain objects, arrays, and YAML core scalar values')
}

// Strings without these characters quote verbatim. Everything else goes through
// JSON escaping; surrogates are included so lone ones get escaped.
const NEEDS_ESCAPE = /["\\\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff\ufffe\uffff]/
// YAML normalizes some literal Unicode control/line-break characters even in
// quoted strings. JSON escaping plus these escapes preserves the JS string.
const YAML_ESCAPE = /[\u007f-\u009f\u2028\u2029\ufffe\uffff]/g

function quote(value: string): string {
  if (!NEEDS_ESCAPE.test(value)) return '"' + value + '"'
  return JSON.stringify(value).replace(
    YAML_ESCAPE,
    (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')
  )
}

function scalar(value: unknown): string {
  if (typeof value === 'string') return quote(value)
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '.nan'
    if (value === Infinity) return '.inf'
    if (value === -Infinity) return '-.inf'
    if (Object.is(value, -0)) return '-0.0'
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === null) return 'null'
  throw new TypeError('stringify does not support ' + typeof value)
}

function dataProperty(value: Collection, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (descriptor && !('value' in descriptor)) {
    throw new TypeError('stringify does not support accessor properties')
  }
  return descriptor?.value
}

function stringify(input: unknown, options: StringifyOptions = {}): string {
  const indent = options.indent ?? 2
  const maxDepth = options.maxDepth ?? 100
  const refs = new Map<Collection, Reference>()
  function count(value: unknown, depth: number): void {
    if (!isCollection(value)) {
      const type = typeof value
      if (value === null || type === 'string' || type === 'number' || type === 'boolean') return
      throw new TypeError('stringify does not support ' + type)
    }
    const known = refs.get(value)
    if (known) {
      known.count++
      return
    }
    if (depth >= maxDepth) {
      throw new RangeError('stringify nesting exceeded maxDepth (' + maxDepth + ')')
    }
    refs.set(value, { count: 1, anchor: -1, emitted: false })
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        count(dataProperty(value, String(index)), depth + 1)
      }
    } else {
      for (const key of Object.keys(value)) count(dataProperty(value, key), depth + 1)
    }
  }
  count(input, 0)
  let anchorId = 0
  for (const ref of refs.values()) if (ref.count > 1) ref.anchor = anchorId++

  // Paddings and quoted keys repeat across the document; build each once.
  const paddings: string[] = []
  const keys = new Map<string, string>()
  let out = ''

  // Appends `value` after `prefix`: inline on the same line for scalars,
  // aliases and empty collections, otherwise as a block on following lines.
  function write(prefix: string, value: unknown, level: number): void {
    if (!isCollection(value)) {
      out += prefix + ' ' + scalar(value) + '\n'
      return
    }
    const ref = refs.get(value)
    if (!ref) throw new TypeError('stringify input changed during serialization')
    if (ref.emitted) {
      if (ref.anchor < 0) throw new TypeError('stringify input changed during serialization')
      out += prefix + ' *ref_' + ref.anchor + '\n'
      return
    }
    if (level >= maxDepth) {
      throw new RangeError('stringify nesting exceeded maxDepth (' + maxDepth + ')')
    }
    ref.emitted = true
    const anchor = ref.anchor === -1 ? '' : ' &ref_' + ref.anchor
    const array = Array.isArray(value)
    const names = array ? null : Object.keys(value)
    const length = array ? value.length : names!.length
    if (length === 0) {
      out += prefix + anchor + (array ? ' []\n' : ' {}\n')
      return
    }
    out += prefix + anchor + '\n'
    block(value, array, names, length, level)
  }

  function block(
    value: Collection,
    array: boolean,
    names: string[] | null,
    length: number,
    level: number
  ): void {
    const padding = (paddings[level] ??= ' '.repeat(indent * level))
    for (let index = 0; index < length; index++) {
      if (array) {
        write(padding + '-', (value as unknown[])[index], level + 1)
      } else {
        const name = names![index]!
        let key = keys.get(name)
        if (key === undefined) keys.set(name, (key = quote(name) + ':'))
        write(padding + key, (value as Record<string, unknown>)[name], level + 1)
      }
    }
  }

  // The root has no parent line: scalars and empty collections stand alone,
  // and a root anchor goes on its own line before the block.
  if (!isCollection(input)) return scalar(input) + '\n'
  const ref = refs.get(input)!
  ref.emitted = true
  const array = Array.isArray(input)
  const names = array ? null : Object.keys(input)
  const length = array ? input.length : names!.length
  const anchor = ref.anchor === -1 ? '' : '&ref_' + ref.anchor
  if (length === 0) return (anchor ? anchor + ' ' : '') + (array ? '[]' : '{}') + '\n'
  if (anchor) out = anchor + '\n'
  block(input, array, names, length, 0)
  return out
}

export { stringify, type StringifyOptions }
