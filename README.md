# miniyaml

Small, dependency-free YAML 1.2 Core `parse` and `stringify` for Node.js and Bare.

## Installation

```sh
npm i miniyaml
```

## Usage

```js
import { parse, stringify } from 'miniyaml'

const config = parse('name: example\nenabled: true\n')
// { name: 'example', enabled: true }

stringify(config)
// '"name": "example"\n"enabled": true\n'
```

## API

#### `const value = parse(source, [options])`

Parse a single YAML document into plain objects, arrays, strings, numbers, booleans and `null`. Scalars resolve with the YAML 1.2 Core schema: dates and `yes`/`no` stay strings, and `<<` is an ordinary key. Only Core tags (`!!str`, `!!int`, `!!float`, `!!bool`, `!!null`, `!!seq`, `!!map`) are accepted.

Throws a `YAMLException` for invalid YAML, empty input, multiple documents, duplicate keys, collection keys, unknown tags and exceeded limits. Non-string keys become strings, so `1: a` and `"1": b` are duplicates.

Options:

```js
{
  filename: '', // included in error messages
  maxDepth: 100, // maximum collection nesting, 1–500
  maxAliases: -1, // maximum aliases per document, -1 for no limit
  maxAliasNodes: 100000, // maximum nodes aliases expand to per document, -1 for no limit
  json: false // allow duplicate keys, keeping the last value
}
```

Aliases resolve to shared references, so a short document can describe a graph whose tree form is exponentially large. `maxAliasNodes` bounds that tree, which keeps walking the result (for example with `JSON.stringify`) proportional to the limit. A cyclic alias still produces a cyclic value.

#### `const text = stringify(value, [options])`

Write plain objects (including null-prototype objects), arrays, strings, finite and non-finite numbers, booleans and `null` as YAML. Keys and strings are always double-quoted, collections use block style, and shared or cyclic references become anchors and aliases, so `parse(stringify(value))` restores the same graph.

Throws for anything else: `undefined`, sparse arrays, functions, symbols, bigints, class instances such as `Date` or `Map`, and getter or setter properties (which are never invoked). Symbol keys and non-index array properties are ignored, as in `JSON.stringify`.

Options:

```js
{
  indent: 2, // spaces per level, 1–10
  maxDepth: 100 // maximum collection nesting, 1–500
}
```

#### `YAMLException`

Error thrown by `parse`. `err.mark` holds `{ name, position, line, column, snippet }`, where `snippet` shows the lines around the error. The full source is not kept on the error.

## Benchmarks

See [benchmark](./benchmark/README.md).

```sh
npm run bench
```

## License

Apache-2.0. The parser is derived from [js-yaml](https://github.com/nodeca/js-yaml) under the MIT License; see [NOTICE.md](./NOTICE.md).
