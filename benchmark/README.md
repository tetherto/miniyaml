# Reproducible library benchmark

Requires Node to prepare fixtures and launch a runtime; the timed worker also runs in Bare. No dependency is installed or downloaded by these scripts.

```sh
node benchmark/benchmark.mjs --output /tmp/miniyaml-node.json
node benchmark/benchmark.mjs --compare visulima=/path/to/visulima-bundle.mjs --reference /path/to/yaml-bundle.mjs --output /tmp/paired-node.json
node benchmark/benchmark.mjs --runtime /path/to/pinned/bare --compare visulima=/path/to/visulima-bundle.mjs --reference /path/to/yaml-bundle.mjs --output /tmp/paired-bare.json
node benchmark/benchmark.mjs --fixture /path/to/github-openapi.yaml --output /tmp/large-node.json
```

`--library` overrides the default `../lib/index.mjs`; comparisons can be existing packages or paths. Use standalone parse+stringify ESM bundles when comparing code size or executing under Bare; raw packages must support that runtime. `js-yaml` adapters use CORE_SCHEMA to control YAML 1.2 scalar semantics. `--reference` chooses the independent parser for correctness checks and serializer for generated input formatting; the local library is the default. Keep the same reference, fixtures, module builds, and runtime versions between comparisons. Run runtimes sequentially without other CPU-heavy jobs.

Committed fixtures are the small real qvac benchmark config, an OpenAPI example, and a configuration covering a wider range of scalar and collection syntax. A 3,000-record JSON-compatible dataset is constructed in memory. Larger external documents are opt-in: for example GitHub's official OpenAPI at https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.yaml. The benchmark records fixture/module hashes; downloads and generated megabyte documents are never committed.

Parsing and stringifying are separate operations. Every case first compares canonical JSON values against the reference, and invalid results are excluded from timings. This checks common data semantics, not complete YAML conformance, reference identity, aliases or safety. Defaults: adaptive warmup/calibration batches of at least 100ms, seven measured batches with rotated library/operation order, median milliseconds per operation. `Date.now` resolution is amortized over each batch; natural garbage collection is included. Imports, IO, validation and dataset generation are excluded. Output byte sizes are recorded to expose formatting tradeoffs. Small overlapping differences are inconclusive; these workloads cannot establish a universally fastest YAML implementation.
