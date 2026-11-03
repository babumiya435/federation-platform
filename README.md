# federation-platform

A small federated GraphQL platform in one repository:

- a **Rust gateway** (Hive Router) with a `@rateLimit` plugin, JWT validation and `@requiresScopes`;
- a **product subgraph** (TypeScript) with `Product` and `Review` as Relay `Node` entities;
- a **node subgraph** (TypeScript) that owns `Query.node(id)` and keeps working when someone
  adds a Node type elsewhere, with no hand edits;
- **schema governance** that runs without a human, locally with one command and in CI.

```
client ──► router (Hive Router, Rust)       JWT · @requiresScopes · @rateLimit · request id
            ├──► product subgraph           Product, Review, products, addReview
            └──► node subgraph              Query.node, asks the owning subgraph
```

Everything below is verified by CI on every pull request; see [What CI runs](#what-ci-runs).
How much of this was written by an AI agent is declared in [LLM-USAGE.md](LLM-USAGE.md).

## Rust experience

I can read Rust comfortably and have written small programs, but I am not a daily Rust
author. The router plugin is the part of this repo I am least fluent in. The design
reasoning is mine to defend; the Rust itself is covered by 23 unit tests and by the
integration scripts, and rough edges are listed under [Not done](#not-done-and-known-limits).

## Quick start

Prerequisites: Docker with Compose; Node 24 (`.nvmrc`) with pnpm 9 (`corepack enable`);
Rust only if you want to build or test the router outside Docker (`rustup` picks the
version pinned in `router/rust-toolchain.toml`).

```sh
docker compose up --build            # router on http://localhost:4000/graphql
ROUTER_PORT=4100 docker compose up   # if port 4000 is taken on your machine
```

Mint a token and call it. The signing key is a **dev-only key committed on purpose** so
the stack and CI need no secrets ([ADR 0005](docs/decisions/0005-composition-and-gateway-wiring.md)).

```sh
TOKEN=$(node scripts/mint-token.mjs --sub alice --scope "catalog:read:internal")
curl -s localhost:4000/graphql -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"query":"{ products(first: 2) { edges { node { name internalCost } } } }"}'
```

Anonymous calls are allowed; protected fields refuse them. Without the scope the same
query fails with `UNAUTHORIZED_FIELD_OR_TYPE`.

```sh
pnpm install
pnpm check            # every check, the same command CI runs
pnpm governance       # just the schema governance checks, each reported separately
pnpm graph:update     # regenerate derived files after changing a subgraph schema
```

A step-by-step walkthrough that maps every requirement to a command and its expected
result is in [docs/verify.md](docs/verify.md).

Scripts that talk to a running stack (`ROUTER_URL` overrides the address):

```sh
node scripts/smoke.mjs              # auth, node(id), tokens
node scripts/request-id-check.mjs   # the router's request id reaches the subgraphs
node scripts/rate-limit-cases.mjs   # @rateLimit behaviour (~40s: it waits out windows)
node scripts/rate-limit-reload.mjs  # change a limit in the supergraph, no restart
node e2e/add-node-type/run.mjs      # add a Node type elsewhere; see below
```

## Layout

```
subgraphs/product   Pothos + Yoga subgraph; schema generated from code, committed
subgraphs/node      node(id); its schema and owners.json are generated, never edited
packages/global-id  the one place ids are encoded and decoded
governance/         composition, operation and breaking-change checks, policy, decisions
clients/operations  client operations the schema checks run against
router/             Rust crate: Hive Router + rate_limit and request_id plugins
supergraph/         the composed supergraph the router loads (generated, committed)
auth/               dev JWKS and signing key (dev only)
e2e/                the add-a-Node-type scenario
docs/               decisions (ADRs), change workflow
```

## The four decisions

Each is argued in an ADR, consistent with the code and tests, and listed here with the
main trade-off. All seven ADRs are indexed in [docs/decisions](docs/decisions/README.md).

**Global ids** ([ADR 0002](docs/decisions/0002-global-ids.md)). `id = base64url("Type:localId")`,
encoded in one shared package, and the id *is* the federation key (`@key(fields: "id")`).
A subgraph that does not own an entity refers to it as `{ __typename, id }`. One key means
one id in client queries, entity representations and `node(id)`, with no mapping layer.
Trade-off: renaming a GraphQL type changes its ids, and ids are forgeable, so access is
enforced on fields, never by an id being unguessable.

**Node** ([ADR 0004](docs/decisions/0004-node-subgraph.md)). The node subgraph's schema and an
`owners.json` are *derived* from the other subgraphs' committed schemas by
`pnpm graph:update`: any object type that `implements Node` is eligible. `node(id)` decodes
the id, checks the type is eligible, then **asks the owning subgraph whether the entity
exists** before returning a stub; the router fetches the real fields. Unknown or
malformed ids return `null`. Four rules (N1-N4) reject declarations the router could not
resolve. The existence check exists because we found, by testing, that the router never
calls the owner for `node(id) { __typename id }`, so a missing product came back as a
stub. Trade-off: one extra round trip per `node(id)`.

**Authorization** ([ADR 0003](docs/decisions/0003-authorization.md)). The router's built-in
`@requiresScopes`, scopes named `<domain>:<action>:<sensitivity>` (`catalog:read:internal`,
`reviews:read:pii`), on object-type fields only: `Product.internalCost` and
`Review.authorEmail`. Never on interfaces, types, or `Query.node`, so protection follows
the entity into `node(id)`. The router runs in **`reject`** mode: a denied non-null field
would otherwise null the whole `node` result, and a caller could not tell "no such
product" from "not allowed". Denied requests get HTTP 403 and `data: null`.

**Rate limits** ([ADR 0006](docs/decisions/0006-rate-limits.md)).
`@rateLimit(limit, windowSeconds, cost = 1)` on object-type fields, enforced by a Rust
plugin before any subgraph is called. Limits are read from the supergraph, so adding or
changing one is a schema change plus `pnpm graph:update`; the router's source is untouched
and it picks the new supergraph up by polling the file. A bad directive fails the supergraph
load and the previous limits stay in force.

- *Caller:* JWT `sub`; anonymous callers by socket address (never `X-Forwarded-For`).
- *Counting:* every aliased occurrence of a limited field costs `cost`; list size does not
  matter; identical same-key fields are merged by GraphQL and count once.
- *Window:* fixed window per (caller, field), counters bounded at 10 000.
- *Rejection:* **the whole request**, HTTP 429, `RATE_LIMITED`, with the field, limit,
  window and `retryAfterSeconds`. Nothing is charged for any field when one is over
  limit, and a rejected request never reaches a subgraph (the router logs
  `subgraph_requests: 0`).
- *With two replicas* each counts on its own, so the effective limit is `limit × replicas`;
  shared counters need an external store and a fail-open or fail-closed choice.

Gateway wiring is in [ADR 0005](docs/decisions/0005-composition-and-gateway-wiring.md): composition
library, the committed supergraph, how a changed supergraph becomes active (the router polls
the mounted file; verified by `rate-limit-reload.mjs`), exactly what the router does with
forged, expired and malformed tokens, and how the request id is forwarded.

## Schema governance

`pnpm governance` runs six checks, keeps going after a failure and prints a summary. CI runs
each as its own job, so a failure names the check that failed.

| Check | Fails when |
|-------|-----------|
| `composition` | the subgraphs do not compose, or `supergraph.graphql` is stale |
| `node-rules` | a Node type breaks rules N1-N4, or the node subgraph is stale |
| `operations` | an operation in `clients/operations` no longer validates against the schema |
| `breaking-changes` | an operation in `clients/operations` **on the target branch** no longer validates against the proposed schema |
| `policy` | the API schema breaks a policy rule: mutation result unions, Relay connections, naming |
| `decisions` | `@requiresScopes` / `@rateLimit` is misplaced or malformed, or a scope is not in `governance/scopes.json` |

A pull request that renames a field a client operation uses fails like this:

```
breaking-changes failed with 1 problem:
  [breaking/operation-no-longer-valid] clients/operations/ListProducts.graphql:7:9  Cannot query field "name" on type "Product". (in query ListProducts) [operation exists on origin/main @ 67129fa; this change would break it]
```

**What the breaking-change check guarantees:** every operation checked in on the target
branch still validates against the proposed schema (fields, arguments, required arguments,
variable types, fragments). **What it does not:** clients whose operations are not checked
in, a field that keeps its name and type but changes meaning, output nullability changes,
enum values sent only through variables, access or rate-limit changes
([ADR 0007](docs/decisions/0007-schema-governance.md) lists them all). To put a field under
protection, add an operation that uses it to `clients/operations/`.

### Branch protection

Checks only block a merge if GitHub is told to require them. For `main` (Settings → Branches,
or a ruleset):

1. require a pull request with an approving review, dismissing stale approvals on new commits;
2. require these status checks: `check`, `composition`, `node-rules`, `operations`,
   `breaking-changes`, `policy`, `decisions`, `stack`, `add-node-type`;
3. require branches to be up to date before merging (so `breaking-changes` always compares
   against the current `main`);
4. block force pushes and deletions, and include administrators.

The workflow has no path filters on purpose: a required job that does not run can leave a
pull request pending.

## Change workflow

Short version: branch, change the source, `pnpm graph:update`, `pnpm check`, open a PR, and
fix whatever check names. The full workflow from ticket to a passing pull request, a table of
what to do when each check fails, and recipes for the common changes (add a Node type,
change a rate limit, add a scope) are in [docs/workflow.md](docs/workflow.md). It applies
whether or not an agent does the typing; agent-specific rules are in [AGENTS.md](AGENTS.md).

Adding a Node type in another subgraph needs no edit to the node subgraph. CI proves it
(job `add-node-type`, `e2e/add-node-type/run.mjs`): it adds a throwaway subgraph that owns a
new type, runs `pnpm graph:update`, starts the stack and resolves the new type through the
router's `node(id)`. It asserts that only the node subgraph's two generated files changed,
shows that a Node type nobody can resolve is rejected by the same workflow, and puts every
file back afterwards.

## What CI runs

| Job | What it checks |
|-----|----------------|
| `check` | everything `pnpm check` runs: TypeScript tests and generated-file drift, composition, governance, and the router's `cargo fmt`, `clippy` and unit tests (94 unit tests in total) |
| `composition`, `node-rules`, `operations`, `breaking-changes`, `policy`, `decisions` | one governance check each |
| `stack` | builds the images (cached), starts docker compose, runs the four stack scripts |
| `add-node-type` | the end-to-end scenario above |

All nine passed on the pull request that added them.

## Not done, and known limits

Left out on purpose:

- **Bonus: public contract** from `@tag(name: "public")`. Not attempted. The composition
  library ships contract helpers (`composeSchemaContract`); the plan would be a rule that
  a field is public only if it carries the tag, a second supergraph built from it, and a
  fixture with an untagged stray field that CI rejects.
- **Persistence, a schema registry, signing between router and subgraphs, observability
  beyond forwarding a request id, production deployment.** Out of scope in the brief.

Known limits and rough edges:

- Rate limits: no `Retry-After` header (the analysis hook cannot set one; the value is in
  the error extensions); a fixed window allows up to 2× the limit across a boundary;
  anonymous callers behind a reverse proxy share one address; a conditionally skipped field
  still counts; counters sit behind one mutex.
- `node(id)` costs an extra round trip and calls owners directly (bypassing router auth,
  safe only because the check returns just `__typename`). There is no `nodes(ids)`.
- Breaking-change detection only sees checked-in operations (see above).
- Policy lint is three hand-written rules over `graphql-js`, not `graphql-eslint`.
- The JWKS is a static file: rotating keys means editing it.
- Branch protection is described, not configured by code.
- The router is built from the `hive-router` crate with three workarounds the docs do not
  mention (a direct `ntex` dependency, `#![recursion_limit = "256"]`, Node in the build
  stage because the crate's build script runs `npm install`).

## Future improvements

In the order I would do them:

1. Shared rate-limit counters (Redis or similar) with an explicit fail-open/closed choice,
   and a sliding window or token bucket to remove the boundary burst.
2. A schema diff alongside the operation check (for example graphql-inspector) and real
   usage data, to cover nullability, enum values and unlisted clients.
3. The public contract bonus, then more policy rules (moving to `graphql-eslint` if they grow).
4. A trusted-proxy setting for the client address, and `Retry-After` through a hook that
   can set headers.
5. Remote JWKS with rotation; cache or push the `node(id)` existence check into the router.
6. Branch protection and required checks as code (a ruleset applied through the API).
