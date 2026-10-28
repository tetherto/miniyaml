# miniyaml

Small, fast YAML 1.2 `parse` and `stringify` for Bare and Node. No dependencies.

```
npm i miniyaml
```

## Usage

```js
const { parse, stringify } = require('miniyaml')

const config = parse('name: example\nports: [80, 443]\n')
// { name: 'example', ports: [80, 443] }

stringify(config)
// 'name: example\nports:\n  - 80\n  - 443\n'
```

## API

#### `const value = parse(source, [options])`

Parse a YAML 1.2 document into plain objects, arrays, strings, numbers, booleans and `null`.

The full YAML 1.2 syntax is supported: block and flow collections, all scalar styles, anchors and aliases, tags, directives and comments. Scalars resolve with the Core schema, so dates and `yes`/`no` stay strings and `<<` is an ordinary key. Only Core tags (`!!str`, `!!int`, `!!float`, `!!bool`, `!!null`, `!!seq`, `!!map`) are accepted.

Throws a `YAMLError` for invalid YAML, empty input, more than one document, duplicate keys, collection keys, other tags and exceeded limits. Keys become strings, so `1: a` and `"1": b` are duplicates.

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

Aliases resolve to shared references, so a short document can describe a graph whose tree form is exponentially large. `maxAliasNodes` bounds that tree, which keeps walking the result, for example with `JSON.stringify`, proportional to the limit. A cyclic alias produces a cyclic value.

#### `const text = stringify(value, [options])`

Write plain objects (including null-prototype objects), arrays, strings, numbers, booleans and `null` as block YAML. Strings are written plain where they read back unchanged and double-quoted otherwise. Shared and cyclic references become anchors and aliases, so `parse(stringify(value))` restores the same graph.

Throws for anything else: `undefined`, sparse arrays, functions, symbols, bigints, class instances such as `Date` or `Map`, and getter or setter properties, which are never invoked. Symbol keys and non-index array properties are ignored, as in `JSON.stringify`.

Options:

```js
{
  indent: 2, // spaces per level, 1–10
  maxDepth: 100 // maximum collection nesting, 1–500
}
```

#### `YAMLError`

Thrown by `parse`, with `reason`, `filename`, `position`, `line` and `column`. The message shows the error's line and the one before it; the source itself is not kept.

## License

Apache-2.0
