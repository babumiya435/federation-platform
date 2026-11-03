# Instructions for coding agents

A federated GraphQL platform: a Rust router (Hive Router) with a `@rateLimit` plugin, two
TypeScript subgraphs (`subgraphs/product` owns Product, `subgraphs/reviews` owns Review, `subgraphs/node` owns `Query.node`), schema governance
(`governance/`) and CI. Read `README.md` and `docs/decisions/` before changing anything;
the decisions there are deliberate and have tests behind them. The human-facing version of
the steps below is `docs/workflow.md`.

## Setup

- Node 24 (`.nvmrc`; `nvm use`), pnpm 9 via `corepack enable`, Rust via rustup (the
  toolchain is pinned in `router/rust-toolchain.toml`), Docker with Compose.
- `pnpm install`. Port 4000 may be taken locally: `ROUTER_PORT=4100 docker compose up`.

## Commands

| Command | Use it to |
|---------|-----------|
| `pnpm check` | run everything CI runs; **run it before saying you are done** |
| `pnpm governance` | run only the schema checks, each reported separately |
| `pnpm graph:update` | regenerate derived files after any schema change |
| `docker compose up --build` | start the stack, then run `scripts/*.mjs` against it |
| `node e2e/add-node-type/run.mjs` | the add-a-Node-type scenario (needs a clean working tree) |

## Rules

- **Never hand-edit generated files**: `subgraphs/*/schema.graphql`, `subgraphs/node/owners.json`,
  `supergraph/supergraph.graphql`. Change the source (subgraph code, `governance/subgraphs.json`)
  and run `pnpm graph:update`. Commit what it regenerates.
- Use `packages/rate-limit-directive` to declare `@rateLimit` and `packages/owner-check` to ask
  another subgraph whether it has an entity; do not copy either into a subgraph.
- **Never edit `subgraphs/node` by hand to add a Node type.** Implement `Node` and key it by
  `id` in the owning subgraph; the node subgraph follows by itself.
- If `breaking-changes` fails, a client operation in `clients/operations/` uses what you
  removed or renamed. Keep the field (deprecate first); do not edit the operation to match.
- Limits come from `@rateLimit` in the schema, scopes from `governance/scopes.json`. Neither
  is ever hard-coded in the router's Rust.
- Record a design decision as a new numbered file in `docs/decisions/` (and its index).
- Keep `LLM-USAGE.md` true: if you generate code, say so for that part. Do not claim review
  that did not happen.
- Commits: small, one logical change each, plain imperative messages explaining why, no
  co-author or tool trailers, no rewriting or backdating history.
- Add a dependency only with a reason in the commit body. Keep `graphql` on 16 and
  `@apollo/subgraph` on 2.13.3: Pothos federation breaks on newer versions.
- The key in `auth/` is a dev-only key committed on purpose. Never add real secrets.

## Things that already cost time

- vitest loads a second (ESM) copy of `graphql` unless it is aliased to the CommonJS one
  (see each package's `vitest.config.ts`); tests drive schemas through Yoga's `fetch`.
- The router crate needs a direct `ntex` dependency, `#![recursion_limit = "256"]`, and Node
  in the Docker build stage.
- After changing a router plugin, rebuild the image before trusting a stack test
  (`docker compose build router`); unit tests do not exercise the hooks.
- `node(id)` for a missing entity only returns `null` because the node subgraph asks the
  owner first. Do not remove that check as "redundant".

## Where things go

- New subgraph: a folder under `subgraphs/` with a `check` script, an entry in
  `governance/subgraphs.json`, and its `schema.graphql` committed.
- New governance rule: in `governance/src/`, with a failing fixture in `governance/fixtures/`.
- Router changes: `router/src/`, with unit tests and, if behaviour changes, a stack script.

## Needs a human

Design decisions in the ADRs, what goes in `clients/operations/`, merging, and branch
protection settings (described in the README, not configurable from the repo).
