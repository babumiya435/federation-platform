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
- [0006 Rate limits](docs/decisions/0006-rate-limits.md)
- [0007 Schema governance](docs/decisions/0007-schema-governance.md)

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

Anonymous calls work too; protected fields refuse them. Checks against a running stack
(`ROUTER_URL` overrides the address):

```sh
node scripts/smoke.mjs                # auth, node(id), tokens
node scripts/rate-limit-cases.mjs     # @rateLimit behaviour, ~40s because it waits out windows
node scripts/rate-limit-reload.mjs    # change a limit in the supergraph, no restart
```

## Rate limits

`@rateLimit(limit, windowSeconds, cost = 1)` on object-type fields, enforced by a Rust
plugin in the router. Limits are read from the supergraph, so adding or changing one is
a schema change plus `pnpm graph:update`; the router's source is not touched and the
router picks the new supergraph up by polling the file. A caller over a limit gets HTTP
429 with a `RATE_LIMITED` error and the **whole request** is refused before any subgraph
is called. Callers are identified by JWT `sub`, anonymous callers by socket address.
Everything else (counting rules, window type, memory bound, what changes with two
replicas, known limitations) is in
[ADR 0006](docs/decisions/0006-rate-limits.md).

The signing key in `auth/` is a **dev-only key committed on purpose** (see
[ADR 0005](docs/decisions/0005-composition-and-gateway-wiring.md)).

## Schema governance

```sh
pnpm governance        # every check below, with a pass/fail summary
```

| Check | Fails when |
|-------|-----------|
| `composition` | the subgraphs do not compose, or `supergraph.graphql` is stale |
| `node-rules` | a Node type breaks rules N1-N4, or the node subgraph is stale |
| `operations` | an operation in `clients/operations` no longer validates against the schema |
| `breaking-changes` | an operation in `clients/operations` **on the target branch** no longer validates against the proposed schema |
| `policy` | the API schema breaks a policy rule (mutation result unions, Relay connections, naming) |
| `decisions` | `@requiresScopes` or `@rateLimit` is misplaced, malformed or uses an unlisted scope |

Each check prints its own result with a rule id and a location, for example:

```
breaking-changes failed with 1 problem:
  [breaking/operation-no-longer-valid] clients/operations/ListProducts.graphql:7:9  Cannot query field "name" on type "Product". (in query ListProducts) [operation exists on origin/main @ 67129fa; this change would break it]
```

To put a field under protection, add an operation that uses it to `clients/operations/`.
What the breaking-change check guarantees, and what it cannot see (clients that are not
checked in, changed meaning, output nullability, enum values sent as variables), is spelled
out in [ADR 0007](docs/decisions/0007-schema-governance.md). In CI each check is its own
job so it shows up as its own status.

### Branch protection

Checks only block a merge if GitHub is told to require them. For `main`, in Settings ->
Branches (or a ruleset): require a pull request with an approving review; require these
status checks: `check`, `composition`, `node-rules`, `operations`, `breaking-changes`,
`policy`, `decisions`; require branches to be up to date before merging (so
`breaking-changes` always compares against the current `main`); block force pushes and
deletions, and include administrators. Details and reasons are in ADR 0007.

## Commands

```sh
pnpm install
pnpm check         # every check, same as CI (TypeScript, composition, Rust fmt/clippy/tests)
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
- [x] Composition and router (`governance/`, `router/`, `docker-compose.yml`)
- [x] `@rateLimit` plugin (`router/src/rate_limit/`)
- [x] Governance checks (`governance/`, `clients/operations/`)
- [ ] Add-a-Node-type CI job
- [ ] Decisions write-up, change workflow, future work
