import makeSnippet from './snippet.ts'

interface Mark {
  name: string
  position: number
  line: number
  column: number
  snippet: string | null
}

// YAML error class. http://stackoverflow.com/questions/8458984
//
function formatError(exception: YAMLException, compact?: boolean) {
  let where = ''

  if (!exception.mark) return exception.reason

  if (exception.mark.name) {
    where += `in "${exception.mark.name}" `
  }

  where += `(${exception.mark.line + 1}:${exception.mark.column + 1})`

  if (!compact && exception.mark.snippet) {
    where += `\n\n${exception.mark.snippet}`
  }

  return `${exception.reason} ${where}`
}

/**
 * A YAML error. Unlike an ordinary `Error`, it adds a source snippet showing
 * the location of the problem to the error message, when available.
 */
class YAMLException extends Error {
  reason: string
  mark?: Mark

  constructor(reason: string, mark?: Mark) {
    super()

    this.name = 'YAMLException'
    this.reason = reason
    this.mark = mark
    this.message = formatError(this, false)
  }

  /**
   * Returns the formatted error, omitting the source snippet in compact mode.
   */
  toString(compact?: boolean) {
    return `${this.name}: ${formatError(this, compact)}`
  }

  /**
   * Builds a YAMLException with a source snippet and throws it. `source` is
   * the raw input text; `position` is an offset into it.
   */
  static throwAt(source: string, position: number, message: string, filename = ''): never {
    let line = 0
    let lineStart = 0

    for (let index = 0; index < position; index++) {
      const ch = source.charCodeAt(index)

      if (ch === 0x0a /* LF */) {
        line++
        lineStart = index + 1
      } else if (ch === 0x0d /* CR */) {
        line++
        if (source.charCodeAt(index + 1) === 0x0a /* LF */) index++
        lineStart = index + 1
      }
    }

    const column = position - lineStart
    // Only the snippet is kept, so errors never carry or retain the whole source.
    const snippet = makeSnippet({ name: filename, buffer: source, position, line, column })
    throw new YAMLException(message, { name: filename, position, line, column, snippet })
  }
}

export { YAMLException }
