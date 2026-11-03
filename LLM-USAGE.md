# LLM usage

Tool: **Claude Code** (Anthropic's CLI coding agent), used interactively in a terminal.

## The short version

**An agent produced the whole repository.** Every source file, test, script, workflow,
fixture and document here was written by Claude Code from my prompts, in batches: scaffold,
product subgraph, node subgraph, composition and router, rate-limit plugin, governance,
CI integration, docs. I did not hand-write code. Commits are authored under my git
identity, contain no co-author trailer, and were made by the agent at my direction.

## By part

| Part | Category | Notes |
|------|----------|-------|
| Plugin (Rust): `router/` | **fully generated** (prompted, not edited by hand) | `rate_limit` (rules, counting, limiter, plugin) and `request_id`, 23 unit tests, ADR 0006, the stack scripts. My Rust is reading-level: the design is mine to defend, the code is the agent's. |
| Node subgraph: `subgraphs/node`, `packages/global-id` | **fully generated** | Discovery rules N1-N4, generator, resolver with the owner check, fixtures, 34 tests, ADRs 0002 and 0004. |
| Product subgraph: `subgraphs/product` | **fully generated** | Pothos + Yoga schema from code, seed data, tests, generated `schema.graphql`. |
| Governance: `governance/`, `clients/` | **fully generated** | Composition, operation and breaking-change checks, policy lint, decision checks, a failing fixture per rule, 32 tests, ADR 0007. |
| CI: `.github/`, `docker-compose.yml`, `docker/`, `e2e/` | **fully generated** | Nine jobs, image build with cache, the add-a-Node-type scenario. |
| Docs: README, ADRs, `docs/`, `AGENTS.md`, this file | **fully generated** | The design choices in the ADRs were proposed by the agent and written up as they were made; I merged them and I am the one who defends them. |

## What I did

- Set the goal and the batch plan, and the working rules (human-style commit messages, no
  tool trailer, no backdated history, decisions recorded in `docs/decisions/`, this
  declaration kept accurate).
- Left review comments on the first pull request (listed below) and merged every pull
  request.
- Created the GitHub repository and credentials, and own branch protection settings.

## Corrections I made to generated work

1. Seed ids were generated as `p1`, `r1`, ... I asked for meaningful ids (PR #1 review
   comments); they are now slugs (`trail-backpack`, `trail-backpack-review-1`) and new
   reviews follow the same format.
2. Generated code used one-letter callback parameters (`p`, `r`, `t`, `e`, `ctx`). I asked
   for descriptive names across the codebase (PR #1) and the agent renamed them.

## How the output was validated

Automated, and run by CI on every pull request: 94 unit tests (12 global-id, 22 node, 5
product, 32 governance, 23 Rust), a failing fixture for every governance and Node rule,
and scripts against the real stack (smoke, rate-limit cases, limit reload without restart,
request-id forwarding, the add-a-Node-type scenario). All nine CI jobs passed on GitHub.

Running the real stack found defects in the agent's own work, which the agent then fixed.
These were found by testing, not by review:

- `node(id)` returned a stub for a well-formed id of a missing product, because the router
  never asks the owner when only `__typename id` is selected. The node subgraph now checks
  with the owner (ADR 0004).
- A forwarded request id differed from the id the router logged; the plugin now forwards
  the router's own id (ADR 0005).
- A test expected a fragment spread six times to cost six units; GraphQL merges identical
  fields, so it costs one. The test and ADR 0006 were corrected.
- An unfinished placeholder in the limiter's eviction function, an incorrect test fixture
  for base64 padding, and three Docker build failures for the router.

## What this declaration does not claim

It does not claim a line-by-line human review of the generated code, and it does not claim
that anything was verified beyond what is listed above.
