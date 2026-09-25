---
description: "The scenario suite that holds the bio-memory design to its own claims: seventeen scripted runs, three-state metrics, and four CI hard constraints."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-benchmark

English | [中文](README.zh.md)

## Summary

`dsh-memory-benchmark` is the adversarial partner of [`dsh-memory`](../memory). It runs seventeen scripted sessions through the *real* pipeline — the same domain, repository, gate, core, observer, and daemon the plugin constructs — and reduces each run to a layered metric.

Two design choices make it useful rather than decorative. A metric with a zero denominator reports `not_evaluable`, never `pass`: an empty measurement that reports success hides the gap. And the four safety constraints (`zombieResurrectionRate == 0`, `deletionResidualRate == 0`, `scopeLeakageRate == 0`, `independenceAccuracy >= 0.95`) treat `not_evaluable` as a failure, so a constraint cannot quietly stop being checked.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```sh
pnpm --filter @deepseek-ai/dsh-memory-benchmark run benchmark
```

The exit code is the contract: `0` only when every hard constraint passed. The run prints one line per scenario and one line per metric.

### The seventeen scenarios

| Id | Checks |
|---|---|
| S001 | A preference stated by the user, confirmed by a tool, reaches semantic memory. |
| S002 | A changed preference resolves as a new version rather than a conflict. |
| S003 | An agent's guess never becomes a memory. |
| S004 | A tool read produces `tool_verified` evidence. |
| S005 | Two tools reporting different values are detected as a contradiction. |
| S006 | A superseded fact keeps its interval rather than being deleted. |
| S007 | A user delete creates a tombstone and marks the memory deleted. |
| S008 | Imperative content is stored labelled, never as an instruction. |
| S009 | A project memory asking to become global is held for approval. |
| S010 | Consolidation cannot resurrect a deleted lineage. |
| S011 | An agent restating a user statement three times is one witness. |
| S012 | A second tool consuming the first's output is not a second witness. |
| S013 | A query in one project never returns another project's memory. |
| S014 | After a delete, a fresh independent observation may re-establish the fact. |
| S015 | Three versions coexist and an `asOf` query returns each. |
| S016 | A query sharing no content word with the store injects nothing. |
| S017 | A deleted member does not block an independent fact in the same group. |

<a id="understand-the-implementation"></a>
## Understand the implementation

```
scenarios/index.ts ──▶ runner.ts ──▶ ScenarioRun (snapshot + recalls + rejects)
                          │
                          ├─ boots the real pipeline over an in-memory medium
                          ├─ advances a monotonic clock per event
                          └─ records every observation, recall, and refusal
                          ▼
                     report.ts ──▶ layered metrics ──▶ ci/hard-constraints.ts ──▶ exit code
```

The metrics are layered along the pipeline so a failure points at the stage that produced it:

| Layer | Metrics |
|---|---|
| Capture | `capturePrecision`, `captureRecall` |
| Semantic | `semanticPrecision`, `semanticRecall` |
| Retrieval | `recallPrecision`, `recallNoise` |
| Safety (hard) | `zombieResurrectionRate`, `deletionResidualRate`, `scopeLeakageRate` |
| Adversarial | `independenceAccuracy`, `temporalResolutionAccuracy` |

`BenchmarkSnapshot` exposes the intermediate state — lineage, evidence grouped by causal origin, resolved version intervals, tombstones, and blocked candidates — so a reviewer can see *why* a metric landed where it did, not just where.

<a id="further-exploration"></a>
## Further Exploration

- [`packages/memory/memory`](../memory) — the system under test.
- [`packages/storage/storage-domain/tests/helpers/memory-backend.ts`](../../storage/storage-domain/tests/helpers/memory-backend.ts) — the shared in-memory backend the domain suite uses; this package carries its own copy because a published `src` may not import another package's test directory.

<a id="model-experience"></a>
## Model Experience

### Benchmark report text

#### What the model sees

Nothing: the report is written to stdout for a human reader, is never assembled into a model request, and this package registers no tool, prompt section, or context provider.

##### Report line shape

```markdown
<status>       <metricName>       <value> (<reason>)
```

#### Token effect

Zero direct: the package adds no tokens to any model request.

#### KV Cache effect

Independent: the benchmark makes no model request, so it cannot affect a cached prefix.

## Known Limitations and Deferred Work

- **Single-process, in-memory medium** — every scenario runs against a fresh in-memory backend, so the suite never exercises the profile's real storage routing, cross-process concurrency, or restart recovery.
- **Scripted, not conversational** — a scenario issues a fixed sequence of observations. It cannot discover a failure that only appears under a real model's phrasing, and it does not exercise the LLM distillation path.
- **Narrow extraction limits what can be measured** — because the rules extract only one triple, `semanticRecall` is measured over a small fact set and a passing score says little about extraction breadth.
- **`recallPrecision` depends on scenario-declared relevance** — a scenario lists the substrings it considers on-topic, so the metric measures agreement with that declaration, not an independent relevance judgement.
- **No latency or cost budget** — the suite measures correctness, not how long a consolidation cycle takes or how much a recall costs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The suite's first run failed four of its own metrics and two of its three hard constraints, and every failure was real: a scope comparison that broke on percent-encoded ids, a resurrection check that counted S014's legitimate re-learning as a zombie, a capture layer that could not extract a user-stated preference, and a clock too coarse to order a delete against a re-observation. Fixing them changed the system under test, not the thresholds — which is the outcome the suite exists to force.

A scenario is a function rather than a data list because several checks must react to what the pipeline produced: deleting a memory requires its id, and re-learning a fact requires observing again after the delete.

The runner owns its own in-memory backend rather than importing `storage-domain`'s test helper: a published `src` may not reach into a sibling package's `tests/`, and the helper would not exist in a packed install.

</details>

**Runtime invariant:** No companion is published. The suite is a CI harness that runs scripted scenarios against a throwaway in-memory backend and exits; it registers no product services, emits no Cordis events, and keeps no state that outlives the run, so it owns no runtime relation an independent companion could observe.
