// YAML 1.2 Core schema scalar resolution.

const NONE: unique symbol = Symbol('NONE')

const TAG = 'tag:yaml.org,2002:'
const STR = TAG + 'str'
const NULL = TAG + 'null'
const BOOL = TAG + 'bool'
const INT = TAG + 'int'
const FLOAT = TAG + 'float'
const SEQ = TAG + 'seq'
const MAP = TAG + 'map'

const INT_PATTERN = /^(?:0o[0-7]+|0x[0-9a-fA-F]+|[-+]?[0-9]+)$/
const INT_EXPLICIT_PATTERN = /^(?:[-+]?0b[01]+|[-+]?0o[0-7]+|[-+]?0x[0-9a-fA-F]+|[-+]?[0-9]+)$/
const FLOAT_PATTERN =
  /^(?:[-+]?[0-9]+(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|[-+]?\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/

function resolveNull(source: string) {
  return source === '' ||
    source === '~' ||
    source === 'null' ||
    source === 'Null' ||
    source === 'NULL'
    ? null
    : NONE
}

function resolveBool(source: string) {
  if (source === 'true' || source === 'True' || source === 'TRUE') return true
  if (source === 'false' || source === 'False' || source === 'FALSE') return false
  return NONE
}

function resolveInt(source: string, explicit: boolean) {
  if (!(explicit ? INT_EXPLICIT_PATTERN : INT_PATTERN).test(source)) return NONE
  const sign = source[0] === '-' ? -1 : 1
  const digits = source[0] === '-' || source[0] === '+' ? source.slice(1) : source
  const radix = digits[1] === 'b' ? 2 : digits[1] === 'o' ? 8 : digits[1] === 'x' ? 16 : 10
  const result = sign * parseInt(radix === 10 ? digits : digits.slice(2), radix)
  return Number.isFinite(result) ? result : NONE
}

function resolveFloat(source: string) {
  if (!FLOAT_PATTERN.test(source)) return NONE
  const value = source.toLowerCase()
  const sign = value[0] === '-' ? -1 : 1
  const unsigned = value[0] === '-' || value[0] === '+' ? value.slice(1) : value
  if (unsigned === '.inf') return sign * Infinity
  if (unsigned === '.nan') return NaN
  const result = sign * parseFloat(unsigned)
  return Number.isFinite(result) ? result : NONE
}

// Plain scalars without a tag. The first character rules out most types
// before any comparison or pattern runs.
function resolvePlain(source: string): unknown {
  const c = source.charCodeAt(0)
  if (source === '' || c === 0x7e /* ~ */ || c === 0x6e /* n */ || c === 0x4e /* N */) {
    const value = resolveNull(source)
    return value === NONE ? source : value
  }
  if (c === 0x74 /* t */ || c === 0x54 /* T */ || c === 0x66 /* f */ || c === 0x46 /* F */) {
    const value = resolveBool(source)
    return value === NONE ? source : value
  }
  if ((c >= 0x30 && c <= 0x39) || c === 0x2d /* - */ || c === 0x2b /* + */ || c === 0x2e /* . */) {
    let value = resolveInt(source, false)
    if (value === NONE) value = resolveFloat(source)
    return value === NONE ? source : value
  }
  return source
}

const TAGS = new Set([STR, NULL, BOOL, INT, FLOAT, SEQ, MAP])

// Scalars with an explicit Core tag; NONE when the value does not match it.
function resolveTagged(tag: string, source: string): unknown {
  switch (tag) {
    case STR:
      return source
    case NULL:
      return resolveNull(source)
    case BOOL:
      return resolveBool(source)
    case INT:
      return resolveInt(source, true)
    case FLOAT:
      return resolveFloat(source)
    case SEQ:
      return source === '' ? [] : NONE
    case MAP:
      return source === '' ? {} : NONE
    default:
      return NONE
  }
}

export { NONE, TAGS, SEQ, MAP, resolvePlain, resolveTagged }
