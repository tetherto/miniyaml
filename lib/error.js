module.exports = class YAMLError extends Error {
  constructor(reason, source, position, filename) {
    let line = 0
    let lineStart = 0
    for (let i = 0; i < position; i++) {
      const c = source.charCodeAt(i)
      if (c === 10 || (c === 13 && source.charCodeAt(i + 1) !== 10)) {
        line++
        lineStart = i + 1
      }
    }
    const column = position - lineStart

    super(
      reason +
        (filename ? ' in "' + filename + '"' : '') +
        ' (' +
        (line + 1) +
        ':' +
        (column + 1) +
        ')\n\n' +
        snippet(source, lineStart, column, line)
    )

    this.name = 'YAMLError'
    this.reason = reason
    this.filename = filename
    this.position = position
    this.line = line
    this.column = column
  }
}

// The error line and the one before it, each cut to 80 characters around the column.
function snippet(source, lineStart, column, line) {
  const from = Math.max(0, column - 40)
  let text = ''
  if (lineStart > 0) {
    const end = lineStart - (source.charCodeAt(lineStart - 2) === 13 ? 2 : 1)
    let start = end
    while (
      start > 0 &&
      source.charCodeAt(start - 1) !== 10 &&
      source.charCodeAt(start - 1) !== 13
    ) {
      start--
    }
    text += gutter(line) + source.slice(start, end).slice(from, from + 80) + '\n'
  }
  let end = lineStart
  while (end < source.length && source.charCodeAt(end) !== 10 && source.charCodeAt(end) !== 13) {
    end++
  }
  text += gutter(line + 1) + source.slice(lineStart, end).slice(from, from + 80) + '\n'
  return text + ' '.repeat(gutter(line + 1).length + column - from) + '^'
}

function gutter(line) {
  return String(line).padStart(5) + ' | '
}
