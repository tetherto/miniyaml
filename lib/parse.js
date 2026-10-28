const { NONE, SEQ, MAP, resolvePlain, resolveTagged, isCoreTag } = require('./core')
const YAMLError = require('./error')

const TAB = 9
const LF = 10
const CR = 13
const SPACE = 32
const BANG = 33
const DQUOTE = 34
const HASH = 35
const PERCENT = 37
const AMP = 38
const SQUOTE = 39
const STAR = 42
const COMMA = 44
const DASH = 45
const DOT = 46
const COLON = 58
const LT = 60
const GT = 62
const QUESTION = 63
const LBRACKET = 91
const BACKSLASH = 92
const RBRACKET = 93
const LBRACE = 123
const PIPE = 124
const RBRACE = 125

// tryKey results
const NO_KEY = 0
const KEY = 1
const VALUE = 2

const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffe\uffff]/
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

const ESCAPES = {
  48: '\0',
  97: '\x07',
  98: '\b',
  116: '\t',
  9: '\t',
  110: '\n',
  118: '\v',
  102: '\f',
  114: '\r',
  101: '\x1b',
  32: ' ',
  34: '"',
  47: '/',
  92: '\\',
  78: '\x85',
  95: '\xa0',
  76: '\u2028',
  80: '\u2029'
}

// Indicators and whitespace that cannot start a plain scalar.
const NO_PLAIN_START = new Uint8Array(128)
for (const c of ' \t\r\n,[]{}#&*!|>\'"%@`') NO_PLAIN_START[c.charCodeAt(0)] = 1

const HEX_ESCAPES = { 120: 2, 117: 4, 85: 8 } // \x \u \U

module.exports = function parse(source, opts = {}) {
  return new Parser(source, opts).stream()
}

class Parser {
  constructor(source, opts) {
    this.src = source
    this.len = source.length
    this.pos = 0
    this.lineStart = 0
    this.filename = opts.filename ?? ''
    this.maxDepth = opts.maxDepth ?? 100
    this.maxAliases = opts.maxAliases ?? -1
    this.maxAliasNodes = opts.maxAliasNodes ?? 100000
    this.json = opts.json ?? false
    this.depth = 0
    this.nodes = 0
    this.aliases = 0
    this.aliasNodes = 0
    this.anchors = new Map()
    this.handles = null
    this.version = false
    this.tag = null
    this.anchor = null
    this.key = null
    this.keyPos = 0
    this.jsonLike = false
  }

  fail(reason, pos = this.pos) {
    throw new YAMLError(reason, this.src, pos, this.filename)
  }

  stream() {
    let bad = CONTROL.exec(this.src)
    if (bad === null && !this.src.isWellFormed()) bad = LONE_SURROGATE.exec(this.src)
    if (bad !== null) this.fail('the stream contains non-printable characters', bad.index)

    let documents = 0
    let value = null

    while (true) {
      if (this.src.charCodeAt(this.pos) === 0xfeff) this.lineStart = ++this.pos
      this.skipSeparation()
      if (this.pos >= this.len) break

      let directives = false
      this.handles = null
      this.version = false
      while (this.src.charCodeAt(this.pos) === PERCENT) {
        this.directive()
        directives = true
        this.skipSeparation()
      }

      let explicit = false
      if (this.atMarker(DASH)) {
        this.pos += 3
        explicit = true
      } else if (directives) {
        this.fail('directives must be followed by "---"')
      } else if (this.atMarker(DOT)) {
        this.pos += 3
        this.endLine()
        continue
      }

      if (documents++ > 0) this.fail('expected a single document in the stream, but found more')
      this.anchors.clear()
      value = this.blockNode(-1, explicit, false, false)

      this.skipSeparation()
      if (this.pos >= this.len) break
      if (this.atMarker(DOT)) {
        this.pos += 3
        this.endLine()
      } else if (!this.atMarker(DASH)) {
        this.fail('unexpected content after the document')
      }
    }

    if (documents === 0) this.fail('expected a document, but the input is empty', 0)
    return value
  }

  directive() {
    const start = ++this.pos
    this.skipToken()
    const name = this.src.slice(start, this.pos)

    if (name === 'YAML') {
      if (this.version) this.fail('duplicate %YAML directive')
      this.skipInline()
      const from = this.pos
      this.skipToken()
      if (!/^1\.[0-9]+$/.test(this.src.slice(from, this.pos))) {
        this.fail('unsupported YAML version', from)
      }
      this.version = true
    } else if (name === 'TAG') {
      this.skipInline()
      let from = this.pos
      this.skipToken()
      const handle = this.src.slice(from, this.pos)
      if (!/^!(?:[0-9A-Za-z-]*!)?$/.test(handle)) this.fail('invalid tag handle', from)
      this.skipInline()
      from = this.pos
      this.skipToken()
      if (from === this.pos) this.fail('expected a tag prefix')
      this.handles ??= Object.create(null)
      if (this.handles[handle] !== undefined) this.fail('duplicate %TAG directive', from)
      this.handles[handle] = this.src.slice(from, this.pos)
    } else {
      // Reserved directives are ignored.
      while (this.pos < this.len && !isBreak(this.src.charCodeAt(this.pos))) this.pos++
    }
    this.endLine()
  }

  // Only whitespace and a comment may follow on this line.
  endLine() {
    this.skipInline()
    const c = this.src.charCodeAt(this.pos)
    if (c === HASH) {
      if (!isWhite(this.src.charCodeAt(this.pos - 1))) {
        this.fail('expected whitespace before a comment')
      }
      while (this.pos < this.len && !isBreak(this.src.charCodeAt(this.pos))) this.pos++
    } else if (!isBreak(c) && this.pos < this.len) {
      this.fail('unexpected content after a marker or directive')
    }
  }

  skipInline() {
    let c = this.src.charCodeAt(this.pos)
    while (c === SPACE || c === TAB) c = this.src.charCodeAt(++this.pos)
  }

  skipToken() {
    while (this.pos < this.len && !isBlank(this.src.charCodeAt(this.pos))) this.pos++
  }

  newline() {
    const src = this.src
    this.pos += src.charCodeAt(this.pos) === CR && src.charCodeAt(this.pos + 1) === LF ? 2 : 1
    this.lineStart = this.pos
  }

  // Skips whitespace, comments and line breaks.
  skipSeparation() {
    const src = this.src
    let pos = this.pos
    while (true) {
      let c = src.charCodeAt(pos)
      while (c === SPACE || c === TAB) c = src.charCodeAt(++pos)
      if (c === HASH) {
        if (pos > this.lineStart && !isWhite(src.charCodeAt(pos - 1))) {
          this.pos = pos
          this.fail('expected whitespace before a comment')
        }
        while (pos < this.len && !isBreak(src.charCodeAt(pos))) pos++
        c = src.charCodeAt(pos)
      }
      if (c !== LF && c !== CR) break
      pos += c === CR && src.charCodeAt(pos + 1) === LF ? 2 : 1
      this.lineStart = pos
    }
    this.pos = pos
  }

  // Only whitespace precedes the position on its line.
  freshLine() {
    for (let i = this.lineStart; i < this.pos; i++) {
      if (!isWhite(this.src.charCodeAt(i))) return false
    }
    return true
  }

  indent() {
    let i = this.lineStart
    while (this.src.charCodeAt(i) === SPACE) i++
    return i - this.lineStart
  }

  atMarker(c) {
    const src = this.src
    const pos = this.pos
    return (
      pos === this.lineStart &&
      src.charCodeAt(pos) === c &&
      src.charCodeAt(pos + 1) === c &&
      src.charCodeAt(pos + 2) === c &&
      isBlank(src.charCodeAt(pos + 3))
    )
  }

  atEnd() {
    return this.pos >= this.len || this.atMarker(DASH) || this.atMarker(DOT)
  }

  enter() {
    if (++this.depth > this.maxDepth) this.fail('nesting exceeded maxDepth (' + this.maxDepth + ')')
  }

  // Block node of a parent at indentation n. `inline` when it follows an
  // indicator on the same line, `compact` when a block collection may start
  // inline, `seqAtParent` when a block sequence may sit at indentation n.
  blockNode(n, inline, compact, seqAtParent) {
    this.skipSeparation()
    if (this.pos >= this.len) return this.empty(null, null)
    let fresh = !inline || this.freshLine()

    if (fresh && !this.belongsTo(n, seqAtParent)) return this.empty(null, null)

    const start = this.nodes
    if (fresh || compact) {
      const result = this.tryKey(n)
      if (result === KEY) return this.blockMap(this.keyPos - this.lineStart, null, null, n, start)
      if (result === VALUE) return this.key
    }

    let c = this.src.charCodeAt(this.pos)
    let tag = null
    let anchor = null
    let propsInline = false

    if (c === BANG || c === AMP) {
      // Properties may span lines; they belong to the node that follows them.
      this.tag = null
      this.anchor = null
      while (true) {
        this.props(false)
        const line = this.lineStart
        this.skipSeparation()
        if (this.pos >= this.len) return this.empty(this.tag, this.anchor)
        c = this.src.charCodeAt(this.pos)
        if (this.lineStart === line) {
          propsInline = true
          break
        }
        if (!this.belongsTo(n, seqAtParent)) return this.empty(this.tag, this.anchor)
        if ((c === BANG && this.tag === null) || (c === AMP && this.anchor === null)) continue
        fresh = true
        tag = this.tag
        anchor = this.anchor
        const result = this.tryKey(n)
        if (result === KEY) {
          return this.blockMap(this.keyPos - this.lineStart, tag, anchor, n, start)
        }
        if (result === VALUE) this.fail('a node cannot have two sets of properties')
        break
      }
      tag = this.tag
      anchor = this.anchor
    }

    if (
      (c === DASH || c === QUESTION || c === COLON) &&
      isBlank(this.src.charCodeAt(this.pos + 1))
    ) {
      if (propsInline || !(fresh || compact)) this.fail('block collections cannot start here')
      if (fresh && this.pos - this.lineStart !== this.indent()) {
        this.fail('tabs cannot be used as indentation')
      }
      if (c === DASH) return this.blockSeq(this.pos - this.lineStart, tag, anchor)
      return this.blockMap(this.pos - this.lineStart, tag, anchor, n, -1)
    }

    if (c === PIPE || c === GT) return this.blockScalar(n, tag, anchor)
    if (c === STAR) {
      if (tag !== null || anchor !== null) this.fail('an alias cannot have node properties')
      return this.alias()
    }
    if (c === LBRACKET || c === LBRACE) return this.flowCollection(n, tag, anchor)

    let value
    if (c === DQUOTE) value = this.scalar(this.doubleQuoted(n), tag, false)
    else if (c === SQUOTE) value = this.scalar(this.singleQuoted(n), tag, false)
    else value = this.scalar(this.plain(n, false), tag, true)

    this.skipInline()
    if (this.src.charCodeAt(this.pos) === COLON && isBlank(this.src.charCodeAt(this.pos + 1))) {
      this.fail('mapping values are not allowed here')
    }
    if (anchor !== null) this.anchors.set(anchor, { value, size: this.nodes - start })
    return value
  }

  // Content at the start of a line belongs to the parent at indentation n.
  belongsTo(n, seqAtParent) {
    if (this.atEnd()) return false
    const indent = this.indent()
    if (indent > n) return true
    return (
      seqAtParent &&
      indent === n &&
      this.pos - this.lineStart === n &&
      this.src.charCodeAt(this.pos) === DASH &&
      isBlank(this.src.charCodeAt(this.pos + 1))
    )
  }

  // Tries to read an implicit key and its ':' on the current line. On KEY the
  // key is in this.key and the position is after the ':'. On VALUE a complete
  // node that is not a key is in this.key. On NO_KEY nothing is consumed.
  tryKey(n) {
    const src = this.src
    const pos = this.pos
    const lineStart = this.lineStart
    const nodes = this.nodes
    let c = src.charCodeAt(pos)
    let tag = null
    let anchor = null

    if (c === BANG || c === AMP) {
      this.tag = null
      this.anchor = null
      this.props(false)
      tag = this.tag
      anchor = this.anchor
      this.skipInline()
      c = src.charCodeAt(this.pos)
      if (isBreak(c) || c === HASH || this.pos >= this.len) {
        this.pos = pos
        return NO_KEY
      }
    }

    let key
    let multiline = false
    if (c === COLON && isBlank(src.charCodeAt(this.pos + 1))) {
      if (tag === null && anchor === null) return NO_KEY
      key = this.empty(tag, anchor)
      anchor = null
    } else if (c === STAR) {
      if (tag !== null || anchor !== null) this.fail('an alias cannot have node properties')
      key = this.alias()
    } else if (c === DQUOTE || c === SQUOTE) {
      const text = c === DQUOTE ? this.doubleQuoted(n) : this.singleQuoted(n)
      multiline = this.lineStart !== lineStart
      key = this.scalar(text, tag, false)
    } else if (c === LBRACKET || c === LBRACE) {
      key = this.flowCollection(n, tag, anchor)
      anchor = null
      multiline = this.lineStart !== lineStart
    } else {
      const end = this.canStartPlain(false) ? this.plainKeyEnd() : -1
      if (end === -1) {
        this.pos = pos
        return NO_KEY
      }
      key = this.scalar(src.slice(this.pos, end), tag, true)
      this.pos = end
    }

    const keyEnd = this.pos
    this.skipInline()
    if (src.charCodeAt(this.pos) !== COLON || !isBlank(src.charCodeAt(this.pos + 1))) {
      // A complete node that the lookahead mistook for a key.
      if (anchor !== null) this.anchors.set(anchor, { value: key, size: this.nodes - nodes })
      this.pos = keyEnd
      this.key = key
      return VALUE
    }

    if (multiline) this.fail('implicit keys must be on a single line', pos)
    if (anchor !== null) this.anchors.set(anchor, { value: key, size: this.nodes - nodes })
    this.key = key
    this.keyPos = pos
    this.pos++
    return KEY
  }

  // End of a plain implicit key on this line, or -1 when no ':' follows it.
  plainKeyEnd() {
    const src = this.src
    let pos = this.pos
    let end = pos
    while (true) {
      const c = src.charCodeAt(pos)
      if (c === COLON) {
        const d = src.charCodeAt(pos + 1)
        if (isBlank(d)) return end
      } else if (c === HASH) {
        if (isWhite(src.charCodeAt(pos - 1))) return -1
      } else if (c !== c || c === LF || c === CR) {
        return -1
      }
      if (c !== SPACE && c !== TAB) end = pos + 1
      pos++
    }
  }

  // Reads a tag and an anchor, in any order, into this.tag and this.anchor.
  props(flow) {
    while (true) {
      const c = this.src.charCodeAt(this.pos)
      if (c === BANG && this.tag === null) this.tag = this.readTag()
      else if (c === AMP && this.anchor === null) this.anchor = this.readName()
      else break
      const d = this.src.charCodeAt(this.pos)
      if (!isWhite(d)) {
        if (!isBlank(d) && !(flow && isFlowIndicator(d))) {
          this.fail('expected whitespace after a node property')
        }
        break
      }
      this.skipInline()
    }
  }

  readName() {
    const start = ++this.pos
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos)
      if (isBlank(c) || isFlowIndicator(c)) break
      this.pos++
    }
    if (this.pos === start) this.fail('expected an anchor or alias name')
    return this.src.slice(start, this.pos)
  }

  readTag() {
    const src = this.src
    const start = this.pos++
    if (src.charCodeAt(this.pos) === LT) {
      const from = ++this.pos
      while (
        this.pos < this.len &&
        src.charCodeAt(this.pos) !== GT &&
        !isBlank(src.charCodeAt(this.pos))
      ) {
        this.pos++
      }
      if (src.charCodeAt(this.pos) !== GT || this.pos === from) {
        this.fail('invalid verbatim tag', start)
      }
      return decodeTag(this, src.slice(from, this.pos++), start)
    }
    while (this.pos < this.len) {
      const c = src.charCodeAt(this.pos)
      if (isBlank(c) || isFlowIndicator(c)) break
      this.pos++
    }
    const token = src.slice(start, this.pos)
    if (token === '!') return '!'
    const bang = token.indexOf('!', 1)
    const handle = bang === -1 ? '!' : token.slice(0, bang + 1)
    const suffix = token.slice(handle.length)
    if (suffix === '') this.fail('expected a tag suffix', start)
    let prefix = this.handles?.[handle]
    if (prefix === undefined) {
      if (handle === '!') prefix = '!'
      else if (handle === '!!') prefix = 'tag:yaml.org,2002:'
      else this.fail('undeclared tag handle "' + handle + '"', start)
    }
    return prefix + decodeTag(this, suffix, start)
  }

  scalar(text, tag, plain) {
    if (tag === null) {
      this.nodes++
      return plain ? resolvePlain(text) : text
    }
    return this.tagged(tag, text)
  }

  tagged(tag, text) {
    this.nodes++
    if (tag === '!') return text
    if (!isCoreTag(tag)) this.fail('unknown tag !<' + tag + '>')
    const value = resolveTagged(tag, text)
    if (value === NONE) this.fail('cannot resolve "' + text + '" as !<' + tag + '>')
    return value
  }

  empty(tag, anchor) {
    const value = tag === null ? (this.nodes++, null) : this.tagged(tag, '')
    if (anchor !== null) this.anchors.set(anchor, { value, size: 1 })
    return value
  }

  alias() {
    const pos = this.pos
    const name = this.readName()
    const target = this.anchors.get(name)
    if (target === undefined) this.fail('unknown alias "' + name + '"', pos)
    if (this.maxAliases !== -1 && ++this.aliases > this.maxAliases) {
      this.fail('aliases exceeded maxAliases (' + this.maxAliases + ')', pos)
    }
    this.aliasNodes += target.size
    if (this.maxAliasNodes !== -1 && this.aliasNodes > this.maxAliasNodes) {
      this.fail(
        'aliases expanded to more than maxAliasNodes (' + this.maxAliasNodes + ') nodes',
        pos
      )
    }
    this.nodes += target.size
    return target.value
  }

  collection(value, tag, expected, anchor) {
    if (tag !== null && tag !== '!' && tag !== expected) {
      this.fail('unknown tag !<' + tag + '> for a collection')
    }
    this.enter()
    this.nodes++
    const ref = { value, size: 1 }
    if (anchor !== null) this.anchors.set(anchor, ref)
    return ref
  }

  set(map, key, value, pos) {
    if (key !== null && typeof key === 'object') this.fail('collection keys are not supported', pos)
    const name = typeof key === 'string' ? key : String(key)
    if (!this.json && Object.prototype.hasOwnProperty.call(map, name)) {
      this.fail('duplicated mapping key', pos)
    }
    if (name === '__proto__') {
      Object.defineProperty(map, name, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      })
    } else {
      map[name] = value
    }
  }

  blockSeq(m, tag, anchor) {
    const start = this.nodes
    const seq = []
    const ref = this.collection(seq, tag, SEQ, anchor)

    while (true) {
      this.pos++
      seq.push(this.blockNode(m, true, true, false))
      this.skipSeparation()
      if (this.atEnd()) break
      if (!this.freshLine()) this.fail('unexpected content after a sequence entry')
      const indent = this.indent()
      if (indent < m) break
      if (indent > m) this.fail('bad indentation of a sequence entry')
      if (this.pos - this.lineStart !== m) this.fail('tabs cannot be used as indentation')
      if (this.src.charCodeAt(this.pos) !== DASH || !isBlank(this.src.charCodeAt(this.pos + 1))) {
        break
      }
    }

    this.depth--
    ref.size = this.nodes - start
    return seq
  }

  // Block mapping at indentation m. With keyStart >= 0 its first key was read
  // already (from that node count on) and the position is after its ':'.
  blockMap(m, tag, anchor, n, keyStart) {
    if (m <= n) this.fail('bad indentation of a mapping entry')
    const hasKey = keyStart !== -1
    const start = hasKey ? keyStart : this.nodes
    const key = this.key
    const keyPos = this.keyPos
    const map = {}
    const ref = this.collection(map, tag, MAP, anchor)

    if (hasKey) this.set(map, key, this.blockNode(m, true, false, true), keyPos)

    for (let first = !hasKey; first || this.next(m); first = false) {
      const src = this.src
      const c = src.charCodeAt(this.pos)
      const keyPos = this.pos
      if (c === QUESTION && isBlank(src.charCodeAt(this.pos + 1))) {
        this.pos++
        const key = this.blockNode(m, true, true, true)
        this.skipSeparation()
        let value = null
        if (
          !this.atEnd() &&
          this.freshLine() &&
          this.indent() === m &&
          this.pos - this.lineStart === m &&
          src.charCodeAt(this.pos) === COLON &&
          isBlank(src.charCodeAt(this.pos + 1))
        ) {
          this.pos++
          value = this.blockNode(m, true, true, true)
        }
        this.set(map, key, value, keyPos)
      } else if (c === COLON && isBlank(src.charCodeAt(this.pos + 1))) {
        this.pos++
        this.nodes++
        this.set(map, null, this.blockNode(m, true, true, true), keyPos)
      } else {
        if (this.tryKey(m) !== KEY) this.fail("could not find expected ':'")
        this.set(map, this.key, this.blockNode(m, true, false, true), keyPos)
      }
    }

    this.depth--
    ref.size = this.nodes - start
    return map
  }

  // Moves to the next entry of a block mapping at indentation m.
  next(m) {
    this.skipSeparation()
    if (this.atEnd()) return false
    if (!this.freshLine()) this.fail('unexpected content after a mapping value')
    const indent = this.indent()
    if (indent < m) return false
    if (indent > m) this.fail('bad indentation of a mapping entry')
    if (this.pos - this.lineStart !== m) this.fail('tabs cannot be used as indentation')
    return true
  }

  // Flow-context separation; lines must stay indented past the parent block.
  flowSpace(n) {
    const line = this.lineStart
    this.skipSeparation()
    if (this.lineStart !== line) {
      if (this.atMarker(DASH) || this.atMarker(DOT)) {
        this.fail('document marker within a flow collection')
      }
      if (this.indent() <= n && n >= 0) this.fail('bad indentation of a flow collection entry')
    }
    if (this.pos >= this.len) this.fail('unexpected end of input within a flow collection')
  }

  flowCollection(n, tag, anchor) {
    const src = this.src
    const isMap = src.charCodeAt(this.pos) === LBRACE
    const close = isMap ? RBRACE : RBRACKET
    const start = this.nodes
    const value = isMap ? {} : []
    const ref = this.collection(value, tag, isMap ? MAP : SEQ, anchor)
    this.pos++

    while (true) {
      this.flowSpace(n)
      let c = src.charCodeAt(this.pos)
      if (c === close) break
      if (c === COMMA) this.fail('unexpected ","')

      const keyPos = this.pos
      const explicit =
        c === QUESTION &&
        (isBlank(src.charCodeAt(this.pos + 1)) || isFlowIndicator(src.charCodeAt(this.pos + 1)))
      let key
      let json = false
      if (explicit) {
        this.pos++
        this.flowSpace(n)
        key = this.flowEntryEnd(close) ? this.empty(null, null) : this.flowNode(n)
        json = this.jsonLike
      } else if (c === COLON && isFlowValue(src.charCodeAt(this.pos + 1))) {
        key = this.empty(null, null)
      } else {
        key = this.flowNode(n)
        json = this.jsonLike
      }

      const keyLine = this.lineStart
      if (isMap || explicit) this.flowSpace(n)
      else this.skipInline()
      c = src.charCodeAt(this.pos)

      if (c === COLON && (json || isFlowValue(src.charCodeAt(this.pos + 1)))) {
        if (!isMap && !explicit && this.lineStart !== keyLine) {
          this.fail('implicit keys must be on a single line')
        }
        this.pos++
        this.flowSpace(n)
        const entry = this.flowEntryEnd(close) ? this.empty(null, null) : this.flowNode(n)
        if (isMap) {
          this.set(value, key, entry, keyPos)
        } else {
          const pair = {}
          this.nodes++
          this.set(pair, key, entry, keyPos)
          value.push(pair)
        }
      } else if (isMap) {
        this.set(value, key, this.empty(null, null), keyPos)
      } else if (explicit) {
        const pair = {}
        this.nodes++
        this.set(pair, key, this.empty(null, null), keyPos)
        value.push(pair)
      } else {
        value.push(key)
      }

      this.flowSpace(n)
      c = src.charCodeAt(this.pos)
      if (c === COMMA) this.pos++
      else if (c !== close) this.fail(isMap ? "expected ',' or '}'" : "expected ',' or ']'")
    }

    this.pos++
    this.depth--
    ref.size = this.nodes - start
    this.jsonLike = true
    return value
  }

  flowEntryEnd(close) {
    const c = this.src.charCodeAt(this.pos)
    return c === COMMA || c === close
  }

  flowNode(n) {
    const src = this.src
    let c = src.charCodeAt(this.pos)
    let tag = null
    let anchor = null
    this.jsonLike = false

    if (c === BANG || c === AMP) {
      this.tag = null
      this.anchor = null
      this.props(true)
      tag = this.tag
      anchor = this.anchor
      this.flowSpace(n)
      c = src.charCodeAt(this.pos)
      if (
        c === COMMA ||
        c === RBRACKET ||
        c === RBRACE ||
        (c === COLON && isFlowValue(src.charCodeAt(this.pos + 1)))
      ) {
        return this.empty(tag, anchor)
      }
    }

    if (c === STAR) {
      if (tag !== null || anchor !== null) this.fail('an alias cannot have node properties')
      return this.alias()
    }
    if (c === LBRACKET || c === LBRACE) return this.flowCollection(n, tag, anchor)

    const start = this.nodes
    let value
    if (c === DQUOTE || c === SQUOTE) {
      value = this.scalar(c === DQUOTE ? this.doubleQuoted(n) : this.singleQuoted(n), tag, false)
      this.jsonLike = true
    } else {
      value = this.scalar(this.plain(n, true), tag, true)
    }
    if (anchor !== null) this.anchors.set(anchor, { value, size: this.nodes - start })
    return value
  }

  canStartPlain(flow) {
    const c = this.src.charCodeAt(this.pos)
    if (c >= 128) return true
    if (c !== c || NO_PLAIN_START[c] === 1) return false
    if (c !== DASH && c !== QUESTION && c !== COLON) return true
    const next = this.src.charCodeAt(this.pos + 1)
    return !isBlank(next) && !(flow && isFlowIndicator(next))
  }

  // Plain scalar of a parent at indentation n, folded over continuation lines.
  plain(n, flow) {
    if (!this.canStartPlain(flow)) this.fail('unexpected character')
    const src = this.src
    const start = this.pos
    let pos = start
    let segment = start
    let end = start
    let out = null

    while (true) {
      let c = src.charCodeAt(pos)
      while (true) {
        if (c === COLON) {
          const d = src.charCodeAt(pos + 1)
          if (isBlank(d) || (flow && isFlowIndicator(d))) break
        } else if (c === HASH) {
          if (isBlank(src.charCodeAt(pos - 1))) break
        } else if (c === LF || c === CR || c !== c || (flow && isFlowIndicator(c))) {
          break
        }
        if (c !== SPACE && c !== TAB) end = pos + 1
        c = src.charCodeAt(++pos)
      }
      if (c !== LF && c !== CR) break

      // Continuation lines are indented past the parent and are not comments.
      const lineStart = this.lineStart
      this.pos = pos
      let empty = -1
      do {
        this.newline()
        empty++
        this.skipInline()
        c = src.charCodeAt(this.pos)
      } while (c === LF || c === CR)

      if (
        c !== c ||
        c === HASH ||
        this.atMarker(DASH) ||
        this.atMarker(DOT) ||
        this.indent() <= n ||
        (flow &&
          (isFlowIndicator(c) || (c === COLON && isFlowValue(src.charCodeAt(this.pos + 1))))) ||
        (c === COLON && isBlank(src.charCodeAt(this.pos + 1)))
      ) {
        this.lineStart = lineStart
        break
      }

      out =
        (out === null ? '' : out) +
        src.slice(segment, end) +
        (empty === 0 ? ' ' : '\n'.repeat(empty))
      segment = this.pos
      end = this.pos
      pos = this.pos
    }

    this.pos = end
    if (out === null) return src.slice(start, end)
    return out + src.slice(segment, end)
  }

  // At a line break inside a quoted scalar: consumes it, the empty lines after
  // it and the next line's leading whitespace. Returns the number of empty lines.
  quotedBreak(n) {
    const src = this.src
    let empty = -1
    let c
    do {
      this.newline()
      empty++
      if (this.atMarker(DASH) || this.atMarker(DOT)) {
        this.fail('document marker within a quoted scalar')
      }
      this.skipInline()
      c = src.charCodeAt(this.pos)
    } while (c === LF || c === CR)
    if (this.pos >= this.len) this.fail('unexpected end of input within a quoted scalar')
    if (n >= 0 && this.indent() <= n) this.fail('bad indentation of a quoted scalar line')
    return empty
  }

  singleQuoted(n) {
    const src = this.src
    let segment = ++this.pos
    let out = ''
    while (true) {
      const c = src.charCodeAt(this.pos)
      if (c === SQUOTE) {
        out += src.slice(segment, this.pos)
        if (src.charCodeAt(this.pos + 1) !== SQUOTE) {
          this.pos++
          return out
        }
        out += "'"
        this.pos += 2
        segment = this.pos
      } else if (c === SPACE || c === TAB || c === LF || c === CR) {
        const ws = this.pos
        this.skipInline()
        const d = src.charCodeAt(this.pos)
        if (d === LF || d === CR) {
          out += src.slice(segment, ws)
          const empty = this.quotedBreak(n)
          out += empty === 0 ? ' ' : '\n'.repeat(empty)
          segment = this.pos
        }
      } else if (c !== c) {
        this.fail('unexpected end of input within a quoted scalar')
      } else {
        this.pos++
      }
    }
  }

  doubleQuoted(n) {
    const src = this.src
    let segment = ++this.pos
    let out = ''
    while (true) {
      let pos = this.pos
      let c = src.charCodeAt(pos)
      while (c > SPACE && c !== DQUOTE && c !== BACKSLASH) c = src.charCodeAt(++pos)
      this.pos = pos

      if (c === DQUOTE) {
        out += src.slice(segment, pos)
        this.pos++
        return out
      }
      if (c === BACKSLASH) {
        out += src.slice(segment, pos)
        const e = src.charCodeAt(pos + 1)
        if (e === LF || e === CR) {
          this.pos++
          const empty = this.quotedBreak(n)
          out += '\n'.repeat(empty)
        } else if (ESCAPES[e] !== undefined) {
          out += ESCAPES[e]
          this.pos += 2
        } else if (HEX_ESCAPES[e] !== undefined) {
          const digits = src.slice(pos + 2, pos + 2 + HEX_ESCAPES[e])
          if (!/^[0-9a-fA-F]+$/.test(digits) || digits.length !== HEX_ESCAPES[e]) {
            this.fail('invalid escape sequence')
          }
          const code = parseInt(digits, 16)
          if (code > 0x10ffff) this.fail('invalid escape sequence')
          out += String.fromCodePoint(code)
          this.pos += 2 + digits.length
        } else {
          this.fail('unknown escape sequence')
        }
        segment = this.pos
      } else if (c === SPACE || c === TAB || c === LF || c === CR) {
        const ws = pos
        this.skipInline()
        const d = src.charCodeAt(this.pos)
        if (d === LF || d === CR) {
          out += src.slice(segment, ws)
          const empty = this.quotedBreak(n)
          out += empty === 0 ? ' ' : '\n'.repeat(empty)
          segment = this.pos
        }
      } else if (c !== c) {
        this.fail('unexpected end of input within a quoted scalar')
      } else {
        this.pos++
      }
    }
  }

  blockScalar(n, tag, anchor) {
    const src = this.src
    const literal = src.charCodeAt(this.pos) === PIPE
    const headerPos = this.pos++
    let chomp = 0 // 0 clip, 1 strip, 2 keep
    let indicator = 0

    for (let i = 0; i < 2; i++) {
      const c = src.charCodeAt(this.pos)
      if ((c === DASH || c === 43) && chomp === 0) {
        chomp = c === DASH ? 1 : 2
        this.pos++
      } else if (c >= 49 && c <= 57 && indicator === 0) {
        indicator = c - 48
        this.pos++
      }
    }
    const c = src.charCodeAt(this.pos)
    if (!isBlank(c) && this.pos < this.len) this.fail('invalid block scalar header', headerPos)
    this.endLine()
    if (this.pos < this.len) this.newline()

    const base = n < 0 ? 0 : n + 1
    let k = indicator === 0 ? -1 : (n < 0 ? 0 : n) + indicator
    if (indicator !== 0 && n < 0) k = indicator - 1

    // Auto-detect indentation from the first non-empty line.
    if (k === -1) {
      let i = this.pos
      let maxEmpty = 0
      while (true) {
        const from = i
        while (src.charCodeAt(i) === SPACE) i++
        const d = src.charCodeAt(i)
        if (d === LF || d === CR || d !== d) {
          maxEmpty = Math.max(maxEmpty, i - from)
          if (d !== d) {
            k = maxEmpty
            break
          }
          i += d === CR && src.charCodeAt(i + 1) === LF ? 2 : 1
          continue
        }
        k = i - from
        if (maxEmpty > k && k >= base) {
          this.fail('leading empty lines are more indented than the content')
        }
        break
      }
      if (k < base) k = base
    }

    let out = ''
    let breaks = 0
    let started = false
    let prevMore = false
    let finalBreak = false

    while (this.pos < this.len) {
      const lineStart = this.pos
      let i = lineStart
      while (i - lineStart < k && src.charCodeAt(i) === SPACE) i++
      let d = src.charCodeAt(i)

      if (
        i - lineStart < k ||
        (k === 0 && this.atMarker(DASH)) ||
        (k === 0 && this.atMarker(DOT))
      ) {
        while (src.charCodeAt(i) === SPACE) i++
        d = src.charCodeAt(i)
        if (d === LF || d === CR) {
          breaks++
          this.pos = i
          this.newline()
          continue
        }
        if (d !== d) {
          this.pos = i
          break
        }
        this.lineStart = lineStart
        this.pos = lineStart
        break
      }

      if (d === LF || d === CR) {
        breaks++
        this.pos = i
        this.newline()
        continue
      }
      if (d !== d) {
        if (i > lineStart) breaks++
        this.pos = i
        break
      }

      let e = i
      while (e < this.len && !isBreak(src.charCodeAt(e))) e++
      const text = src.slice(i, e)
      const more = d === SPACE || d === TAB

      if (!started) {
        out += '\n'.repeat(breaks)
        started = true
      } else if (literal) {
        out += '\n'.repeat(breaks + 1)
      } else if (!more && !prevMore) {
        out += breaks === 0 ? ' ' : '\n'.repeat(breaks)
      } else {
        out += '\n'.repeat(breaks + 1)
      }
      out += text
      prevMore = more
      breaks = 0
      finalBreak = true
      this.pos = e
      if (e >= this.len) break
      this.newline()
    }

    if (chomp === 2) out += (started && finalBreak ? '\n' : '') + '\n'.repeat(breaks)
    else if (chomp === 0 && started && finalBreak) out += '\n'

    const value = tag === null ? (this.nodes++, out) : this.tagged(tag, out)
    if (anchor !== null) this.anchors.set(anchor, { value, size: 1 })
    return value
  }
}

function decodeTag(parser, text, pos) {
  if (text.indexOf('%') === -1) return text
  try {
    return decodeURIComponent(text)
  } catch {
    parser.fail('invalid tag escape', pos)
  }
}

function isBreak(c) {
  return c === LF || c === CR
}

function isWhite(c) {
  return c === SPACE || c === TAB
}

// Whitespace, a line break or the end of input.
function isBlank(c) {
  return c === SPACE || c === TAB || c === LF || c === CR || c !== c
}

function isFlowIndicator(c) {
  return c === COMMA || c === LBRACKET || c === RBRACKET || c === LBRACE || c === RBRACE
}

function isFlowValue(c) {
  return isBlank(c) || isFlowIndicator(c)
}
