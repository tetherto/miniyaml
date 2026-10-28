# benchmark

Times `parse` and `stringify` separately, after checking each result against a reference parser. Runs on Node, or on Bare with `--runtime`. Installs and downloads nothing.

```sh
node benchmark/benchmark.mjs
node benchmark/benchmark.mjs --compare other=/path/to/bundle.mjs --reference /path/to/yaml-bundle.mjs
node benchmark/benchmark.mjs --runtime /path/to/bare --fixture /path/to/large.yaml --output results.json
```

- `--library` replaces the default `../index.js`.
- `--compare name=module` adds a library; modules exporting `parse`/`stringify` or js-yaml style `load`/`dump` work.
- `--reference module` is the parser used for correctness checks and the writer used for the generated input; defaults to this library.
- `--fixture file.yaml` adds a document, for example GitHub's OpenAPI description.
- `--rounds` (default 7) and `--batch-ms` (default 100) control sampling.

Fixtures are a qvac benchmark config, a small OpenAPI document and a config covering more syntax; a 3,000-record dataset is generated in memory. Results report the median milliseconds per operation, and output sizes.
