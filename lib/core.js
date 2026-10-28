// YAML 1.2 Core schema: resolves scalar text to null, booleans, numbers and strings.

const NONE = Symbol('NONE')

const TAG = 'tag:yaml.org,2002:'
const STR = TAG + 'str'
const NULL = TAG + 'null'
const BOOL = TAG + 'bool'
const INT = TAG + 'int'
const FLOAT = TAG + 'float'
const SEQ = TAG + 'seq'
const MAP = TAG + 'map'

const INT_PATTERN = /^(?:[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$/
const INT_TAGGED_PATTERN = /^[-+]?(?:[0-9]+|0b[01]+|0o[0-7]+|0x[0-9a-fA-F]+)$/
const FLOAT_PATTERN =
  /^[-+]?(?:(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?|\.(?:inf|Inf|INF))$|^\.(?:nan|NaN|NAN)$/

function resolveNull(text) {
  return text === '' || text === '~' || text === 'null' || text === 'Null' || text === 'NULL'
    ? null
    : NONE
}

function resolveBool(text) {
  if (text === 'true' || text === 'True' || text === 'TRUE') return true
  if (text === 'false' || text === 'False' || text === 'FALSE') return false
  return NONE
}

function resolveInt(text, pattern) {
  if (!pattern.test(text)) return NONE
  const sign = text.charCodeAt(0) === 45 ? -1 : 1
  const digits = sign === -1 || text.charCodeAt(0) === 43 ? text.slice(1) : text
  const radix = digits[1] === 'x' ? 16 : digits[1] === 'o' ? 8 : digits[1] === 'b' ? 2 : 10
  const value = sign * parseInt(radix === 10 ? digits : digits.slice(2), radix)
  return Number.isFinite(value) ? value : NONE
}

function resolveFloat(text) {
  if (!FLOAT_PATTERN.test(text)) return NONE
  const last = text.charCodeAt(text.length - 1)
  if (last === 110 || last === 78) return NaN // .nan
  if (last === 102 || last === 70) return text.charCodeAt(0) === 45 ? -Infinity : Infinity // .inf
  const value = parseFloat(text)
  return Number.isFinite(value) ? value : NONE
}

// Untagged plain scalars. The first character rules out most types.
function resolvePlain(text) {
  const c = text.charCodeAt(0)
  let value = NONE
  if (text === '' || c === 126 || c === 110 || c === 78) {
    value = resolveNull(text) // ~ n N
  } else if (c === 116 || c === 84 || c === 102 || c === 70) {
    value = resolveBool(text) // t T f F
  } else if ((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46) {
    value = resolveInt(text, INT_PATTERN) // digit - + .
    if (value === NONE) value = resolveFloat(text)
  }
  return value === NONE ? text : value
}

// Scalars with an explicit Core tag. Returns NONE when the text does not match.
function resolveTagged(tag, text) {
  switch (tag) {
    case STR:
      return text
    case NULL:
      return resolveNull(text)
    case BOOL:
      return resolveBool(text)
    case INT:
      return resolveInt(text, INT_TAGGED_PATTERN)
    case FLOAT:
      return resolveFloat(text)
    case SEQ:
      return text === '' ? [] : NONE
    case MAP:
      return text === '' ? {} : NONE
  }
  return NONE
}

function isCoreTag(tag) {
  return (
    tag === STR ||
    tag === NULL ||
    tag === BOOL ||
    tag === INT ||
    tag === FLOAT ||
    tag === SEQ ||
    tag === MAP
  )
}

module.exports = { NONE, SEQ, MAP, resolvePlain, resolveTagged, isCoreTag }
