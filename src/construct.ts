import { EVENT_ID, SCALAR_STYLE, type Event, type ScalarEvent } from './parser/events.ts'
import { getScalarValue } from './parser/parser_scalar.ts'
import { tagNameFull } from './tagname.ts'
import { NONE, TAGS, SEQ, MAP, resolvePlain, resolveTagged } from './core.ts'
import { YAMLException } from './exception.ts'

const NO_RANGE = -1
const DOCUMENT = 0
const SEQUENCE = 1
const MAPPING = 2

interface ConstructOptions {
  filename: string
  maxDepth: number
  maxAliases: number
  maxAliasNodes: number
  json: boolean
}

interface Anchor {
  value: unknown
  // Node count with nested aliases expanded; 1 until a collection is complete.
  size: number
}

class Frame {
  kind: number
  value: any
  anchor: Anchor | null
  size: number
  key: string
  keyPosition: number
  hasKey: boolean

  constructor(kind: number, value: unknown, anchor: Anchor | null) {
    this.kind = kind
    this.value = value
    this.anchor = anchor
    this.size = kind === DOCUMENT ? 0 : 1
    this.key = ''
    this.keyPosition = 0
    this.hasKey = false
  }
}

function eventPosition(event: Event) {
  switch (event.type) {
    case EVENT_ID.SCALAR:
      if (event.tagStart !== NO_RANGE) return event.tagStart
      if (event.anchorStart !== NO_RANGE) return event.anchorStart
      return event.valueStart !== NO_RANGE ? event.valueStart : 0
    case EVENT_ID.SEQUENCE:
    case EVENT_ID.MAPPING:
      if (event.tagStart !== NO_RANGE) return event.tagStart
      if (event.anchorStart !== NO_RANGE) return event.anchorStart
      return event.start
    case EVENT_ID.ALIAS:
      return event.anchorStart
    default:
      return 0
  }
}

// Builds the single document in `events` from the Core schema: plain objects,
// arrays, strings, numbers, booleans and null.
function construct(source: string, events: Event[], options: ConstructOptions): unknown {
  const frames: Frame[] = []
  const anchors = new Map<string, Anchor>()
  let handlers: Record<string, string> = Object.create(null)
  let documents = 0
  let result: unknown
  let position = 0
  let aliases = 0
  let aliasNodes = 0

  function fail(message: string, at = position): never {
    YAMLException.throwAt(source, at, message, options.filename)
  }

  function tagOf(event: { tagStart: number; tagEnd: number }) {
    if (event.tagStart === NO_RANGE) return ''
    const raw = source.slice(event.tagStart, event.tagEnd)
    return raw === '!' ? '' : tagNameFull(raw, handlers)
  }

  function scalar(event: ScalarEvent) {
    const text = getScalarValue(source, event)
    if (event.tagStart === NO_RANGE) {
      return event.style === SCALAR_STYLE.PLAIN ? resolvePlain(text) : text
    }
    const tag = tagOf(event)
    if (tag === '') return text
    if (!TAGS.has(tag)) fail(`unknown scalar tag !<${tag}>`)
    const value = resolveTagged(tag, text)
    if (value === NONE) fail(`cannot resolve a node with !<${tag}> explicit tag`)
    return value
  }

  function anchor(event: { anchorStart: number; anchorEnd: number }, value: unknown) {
    if (event.anchorStart === NO_RANGE) return null
    const entry = { value, size: 1 }
    anchors.set(source.slice(event.anchorStart, event.anchorEnd), entry)
    return entry
  }

  function open(
    kind: number,
    value: unknown,
    event: Event & { anchorStart: number; anchorEnd: number }
  ) {
    // Every frame but the document one is an open collection.
    if (frames.length > options.maxDepth) fail(`nesting exceeded maxDepth (${options.maxDepth})`)
    frames.push(new Frame(kind, value, anchor(event, value)))
  }

  function add(value: unknown, size: number) {
    const frame = frames[frames.length - 1]!
    frame.size += size
    if (frame.kind === SEQUENCE) {
      frame.value.push(value)
    } else if (frame.kind === MAPPING) {
      if (!frame.hasKey) {
        if (value !== null && typeof value === 'object') {
          fail('complex mapping keys are not supported')
        }
        frame.key = String(value)
        frame.keyPosition = position
        frame.hasKey = true
        return
      }
      frame.hasKey = false
      const map = frame.value
      const key = frame.key
      if (!options.json && Object.prototype.hasOwnProperty.call(map, key)) {
        fail('duplicated mapping key', frame.keyPosition)
      }
      if (key === '__proto__') {
        // An own data property; plain assignment would invoke the prototype setter.
        Object.defineProperty(map, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true
        })
      } else {
        map[key] = value
      }
    } else {
      result = value
    }
  }

  for (const event of events) {
    position = eventPosition(event)

    switch (event.type) {
      case EVENT_ID.DOCUMENT:
        if (++documents > 1) fail('expected a single document in the stream, but found more')
        handlers = Object.create(null)
        for (const directive of event.directives) {
          if (directive.kind === 'tag') handlers[directive.handle] = directive.prefix
        }
        frames.push(new Frame(DOCUMENT, undefined, null))
        break

      case EVENT_ID.SCALAR: {
        const value = scalar(event)
        anchor(event, value)
        add(value, 1)
        break
      }

      case EVENT_ID.SEQUENCE: {
        const tag = tagOf(event)
        if (tag !== '' && tag !== SEQ) fail(`unknown sequence tag !<${tag}>`)
        open(SEQUENCE, [], event)
        break
      }

      case EVENT_ID.MAPPING: {
        const tag = tagOf(event)
        if (tag !== '' && tag !== MAP) fail(`unknown mapping tag !<${tag}>`)
        open(MAPPING, {}, event)
        break
      }

      case EVENT_ID.ALIAS: {
        const name = source.slice(event.anchorStart, event.anchorEnd)
        const target = anchors.get(name)
        if (!target) fail(`unidentified alias "${name}"`)
        if (options.maxAliases !== -1 && ++aliases > options.maxAliases) {
          fail(`aliases exceeded maxAliases (${options.maxAliases})`)
        }
        aliasNodes += target.size
        if (options.maxAliasNodes !== -1 && aliasNodes > options.maxAliasNodes) {
          fail(`aliases expanded to more than maxAliasNodes (${options.maxAliasNodes}) nodes`)
        }
        add(target.value, target.size)
        break
      }

      case EVENT_ID.POP: {
        const frame = frames.pop()!
        if (frame.kind === DOCUMENT) break
        if (frame.anchor) frame.anchor.size = frame.size
        add(frame.value, frame.size)
        break
      }
    }
  }

  if (documents === 0) fail('expected a document, but the input is empty', 0)
  return result
}

export { construct, type ConstructOptions }
