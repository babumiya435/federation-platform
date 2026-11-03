# LLM usage

Tool: Claude Code (Anthropic CLI agent), driven interactively by me.

This file is updated as work lands, so it describes what actually happened rather
than a plan. Categories: **by hand**, **assisted**, **fully generated**.

| Part            | Status          | Notes |
|-----------------|-----------------|-------|
| Repo scaffold   | fully generated | Workspace files, CI skeleton, ADR 0001, README/LLM-USAGE skeletons. Prompted, not edited so far. |
| Plugin (Rust)   | fully generated | `router/src/rate_limit/` (rules, counting, limiter, plugin), its tests, the integration scripts and ADR 0006. Prompted, human review pending. My Rust is reading-level, so the design is mine to defend and the Rust itself needs a careful read. |
| Node subgraph   | fully generated | Discovery rules, generator, resolver, fixtures, tests, ADR 0004. Prompted, human review pending. |
| Global-id lib   | fully generated | `packages/global-id` with tests. Prompted, human review pending. |
| Product subgraph| fully generated | Pothos + Yoga subgraph, seed data, tests, generated `schema.graphql`. Prompted, human review pending. |
| Governance      | partial         | Composition script and tests generated; lint, breaking-change and decision checks not started. Prompted, human review pending. |
| CI              | partial         | Workflow runs `pnpm check` incl. Rust fmt/clippy/tests (generated). Router image build and the integration scripts are not in CI yet. |
| Docs            | in progress     | ADRs 0001-0006 and README drafted by the agent; I need to confirm each decision before the call. |

## Corrections made to generated work

1. Seed ids were generated as `p1`, `r1`, ... I asked for meaningful ids; they are now slugs
   (`trail-backpack`, `trail-backpack-review-1`) and new reviews follow the same format.
2. Generated code used one-letter callback parameters (`p`, `r`, `t`, `e`, `ctx`). I asked for
   descriptive names across the codebase and the agent renamed them.
