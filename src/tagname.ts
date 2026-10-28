const DEFAULT_TAG_HANDLERS: Readonly<Record<string, string>> = Object.assign(Object.create(null), {
  '!': '!',
  '!!': 'tag:yaml.org,2002:'
})

function tagPercentDecode(source: string) {
  let result = ''
  let index = 0

  // Convert escaped UTF-8 bytes without validating malformed encodings.
  while (index < source.length) {
    if (source.charCodeAt(index) !== 0x25 /* % */) {
      result += source[index++]
      continue
    }

    let ch = parseInt(source.slice(index + 1, index + 3), 16)
    index += 3

    if (ch >= 0xc0) {
      let remaining = ch < 0xe0 ? 1 : ch < 0xf0 ? 2 : 3
      ch &= (1 << (6 - remaining)) - 1

      while (remaining-- > 0) {
        ch = (ch << 6) | (parseInt(source.slice(index + 1, index + 3), 16) & 0x3f)
        index += 3
      }
    }

    if (ch < 0x10000) {
      result += String.fromCharCode(ch)
    } else {
      ch -= 0x10000
      result += String.fromCharCode(0xd800 | (ch >> 10), 0xdc00 | (ch & 0x3ff))
    }
  }

  return result
}

function tagNameFull(rawTag: string, tagHandlers?: Readonly<Record<string, string>>) {
  if (rawTag.startsWith('!<') && rawTag.endsWith('>')) {
    return tagPercentDecode(rawTag.slice(2, -1))
  }

  const handleEnd = rawTag.indexOf('!', 1)
  const handle = handleEnd === -1 ? '!' : rawTag.slice(0, handleEnd + 1)
  const prefix = tagHandlers?.[handle] ?? DEFAULT_TAG_HANDLERS[handle] ?? handle

  return tagPercentDecode(prefix) + tagPercentDecode(rawTag.slice(handle.length))
}

export { tagNameFull }
