const { resolvePlain } = require('./core')

// Strings with none of these characters can be double-quoted verbatim.
const NEEDS_ESCAPE = /["\\\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff\ufeff\ufffe\uffff]/
// Escaped beyond JSON, as YAML normalizes them even inside quotes.
const YAML_ESCAPE = /[\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/g
// Plain style: printable, no indicator first, no ': ' or ' #', no trailing space or ':'.
const UNSAFE = '\\0-\\x1f\\x7f-\\x9f\\u2028\\u2029\\ud800-\\udfff\\ufeff\\ufffe\\uffff'
const PAIR = '[\\ud800-\\udbff][\\udc00-\\udfff]'
const PLAIN = new RegExp(
  '^(?:[^\\s' +
    UNSAFE +
    '\\-?:,[\\]{}#&*!|>\'"%@`]|' +
    PAIR +
    ')' +
    '(?:[^' +
    UNSAFE +
    ':#]|' +
    PAIR +
    '|:(?! )|(?<! )#)*(?<![ :])$'
)

module.exports = function stringify(input, opts = {}) {
  return new Writer(opts).write(input)
}

class Writer {
  constructor(opts) {
    this.indent = opts.indent ?? 2
    this.maxDepth = opts.maxDepth ?? 100
    this.refs = new Map()
    this.paddings = []
    this.keys = new Map()
    this.out = ''
  }

  write(input) {
    this.count(input, 0)
    let id = 0
    for (const ref of this.refs.values()) if (ref.count > 1) ref.anchor = id++

    if (!isCollection(input)) return scalar(input) + '\n'
    const ref = this.refs.get(input)
    ref.emitted = true
    const anchor = ref.anchor === -1 ? '' : '&a' + ref.anchor
    const names = Array.isArray(input) ? null : Object.keys(input)
    const length = names === null ? input.length : names.length
    if (length === 0) return (anchor ? anchor + ' ' : '') + (names === null ? '[]' : '{}') + '\n'
    if (anchor) this.out = anchor + '\n'
    this.block(input, names, length, 0)
    return this.out
  }

  // Counts references to every collection, so repeated ones get anchors.
  count(value, depth) {
    if (!isCollection(value)) {
      const type = typeof value
      if (value === null || type === 'string' || type === 'number' || type === 'boolean') return
      throw new TypeError('stringify does not support ' + type)
    }
    const known = this.refs.get(value)
    if (known !== undefined) {
      known.count++
      return
    }
    if (depth >= this.maxDepth) {
      throw new RangeError('stringify nesting exceeded maxDepth (' + this.maxDepth + ')')
    }
    this.refs.set(value, { count: 1, anchor: -1, emitted: false })
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) this.count(dataProperty(value, String(i)), depth + 1)
    } else {
      for (const key of Object.keys(value)) this.count(dataProperty(value, key), depth + 1)
    }
  }

  block(value, names, length, level) {
    const padding = (this.paddings[level] ??= ' '.repeat(this.indent * level))
    for (let i = 0; i < length; i++) {
      if (names === null) {
        this.entry(padding + '-', value[i], level + 1)
      } else {
        const name = names[i]
        let key = this.keys.get(name)
        if (key === undefined) this.keys.set(name, (key = string(name) + ':'))
        this.entry(padding + key, value[name], level + 1)
      }
    }
  }

  // Scalars, aliases and empty collections stay on the prefix line.
  entry(prefix, value, level) {
    if (!isCollection(value)) {
      this.out += prefix + ' ' + scalar(value) + '\n'
      return
    }
    const ref = this.refs.get(value)
    if (ref === undefined || (ref.emitted && ref.anchor === -1)) {
      throw new TypeError('stringify input changed during serialization')
    }
    if (ref.emitted) {
      this.out += prefix + ' *a' + ref.anchor + '\n'
      return
    }
    ref.emitted = true
    const anchor = ref.anchor === -1 ? '' : ' &a' + ref.anchor
    const names = Array.isArray(value) ? null : Object.keys(value)
    const length = names === null ? value.length : names.length
    if (length === 0) {
      this.out += prefix + anchor + (names === null ? ' []\n' : ' {}\n')
      return
    }
    this.out += prefix + anchor + '\n'
    this.block(value, names, length, level)
  }
}

function isCollection(value) {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return true
  const prototype = Object.getPrototypeOf(value)
  if (prototype === Object.prototype || prototype === null) return true
  throw new TypeError('stringify supports only plain objects, arrays and YAML Core scalars')
}

function dataProperty(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (descriptor !== undefined && !('value' in descriptor)) {
    throw new TypeError('stringify does not support accessor properties')
  }
  return descriptor?.value
}

function scalar(value) {
  if (typeof value === 'string') return string(value)
  if (typeof value === 'number') {
    if (value !== value) return '.nan'
    if (value === Infinity) return '.inf'
    if (value === -Infinity) return '-.inf'
    if (value === 0 && 1 / value < 0) return '-0.0'
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === null) return 'null'
  throw new TypeError('stringify does not support ' + typeof value)
}

function string(value) {
  if (
    value.length <= 1024 &&
    PLAIN.test(value) &&
    !value.startsWith('...') &&
    resolvePlain(value) === value
  ) {
    return value
  }
  if (!NEEDS_ESCAPE.test(value)) return '"' + value + '"'
  return JSON.stringify(value).replace(
    YAML_ESCAPE,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
  )
}
