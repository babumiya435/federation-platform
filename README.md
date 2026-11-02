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

## Layout

See [docs/decisions/0001-repo-layout.md](docs/decisions/0001-repo-layout.md).

## Commands

```sh
pnpm install
pnpm check      # every check, same as CI
```

## Status

- [x] Repo scaffold
- [ ] Product subgraph
- [ ] Node subgraph
- [ ] Composition and router
- [ ] `@rateLimit` plugin
- [ ] Governance checks
- [ ] Add-a-Node-type CI job
- [ ] Decisions write-up, change workflow, future work
