# federation-platform

A small federated GraphQL platform: a Rust gateway (Hive Router) with a `@rateLimit`
plugin, a Node subgraph that makes entities refetchable by id, a product subgraph,
and schema governance that runs in CI without a human.

> Work in progress. Sections below are filled in as each part lands; anything not
> yet written is listed under [Status](#status).

## Rust experience

I can read Rust comfortably and have written small programs, but I am not a daily
Rust author. The router plugin is the most unfamiliar part of this repo for me; the
design reasoning is mine to defend, and rough edges in the Rust are noted where I
know of them.

## Prerequisites

- Node 20+ and pnpm 9 (`corepack enable` picks up the pinned version)
- Rust (stable) via rustup
- Docker with Compose

## Decisions

- [0001 Repo layout](docs/decisions/0001-repo-layout.md)
- [0002 Global ids](docs/decisions/0002-global-ids.md)
- [0003 Authorization](docs/decisions/0003-authorization.md)
- [0004 Node subgraph](docs/decisions/0004-node-subgraph.md)
- [0005 Composition and gateway wiring](docs/decisions/0005-composition-and-gateway-wiring.md)

## Layout

See [docs/decisions/0001-repo-layout.md](docs/decisions/0001-repo-layout.md).

## Run the stack

```sh
docker compose up --build          # router on http://localhost:4000/graphql
ROUTER_PORT=4100 docker compose up # if 4000 is taken on your machine
```

The router is Hive Router built from `router/` (a small Rust crate; the `@rateLimit`
plugin is registered there). Mint a token and call it:

```sh
TOKEN=$(node scripts/mint-token.mjs --sub alice --scope "catalog:read:internal")
curl -s localhost:4000/graphql -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"query":"{ products(first: 2) { edges { node { name internalCost } } } }"}'
```

Anonymous calls work too; protected fields refuse them. `node scripts/smoke.mjs` runs
a set of checks against a running stack (`ROUTER_URL` overrides the address).

The signing key in `auth/` is a **dev-only key committed on purpose** (see
[ADR 0005](docs/decisions/0005-composition-and-gateway-wiring.md)).

## Commands

```sh
pnpm install
pnpm check         # every check, same as CI
pnpm graph:update  # regenerate derived artifacts: subgraph schemas, node subgraph, supergraph
```

### Router build notes

Things that were not obvious from the docs, so the next person does not lose time:
the crate needs a direct `ntex` dependency (the `#[hive_router::main]` macro expands to
`ntex` code), release builds need `#![recursion_limit = "256"]`, and `hive-router`'s
build script runs `npm install`, so the Docker build stage installs Node.

## Status

- [x] Repo scaffold
- [x] Product subgraph (`subgraphs/product`, schema generated from code and committed)
- [x] Node subgraph (`subgraphs/node`, schema derived from the other subgraphs)
- [x] Composition and router (`governance/`, `router/`, `docker-compose.yml`; no plugin yet)
- [ ] `@rateLimit` plugin
- [ ] Governance checks
- [ ] Add-a-Node-type CI job
- [ ] Decisions write-up, change workflow, future work
