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

## Layout

See [docs/decisions/0001-repo-layout.md](docs/decisions/0001-repo-layout.md).

## Commands

```sh
pnpm install
pnpm check         # every check, same as CI
pnpm graph:update  # regenerate derived artifacts (subgraph schemas, node subgraph)
```

## Status

- [x] Repo scaffold
- [x] Product subgraph (`subgraphs/product`, schema generated from code and committed)
- [x] Node subgraph (`subgraphs/node`, schema derived from the other subgraphs)
- [ ] Composition and router
- [ ] `@rateLimit` plugin
- [ ] Governance checks
- [ ] Add-a-Node-type CI job
- [ ] Decisions write-up, change workflow, future work
