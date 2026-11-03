# Running the stack and verifying the requirements

A walkthrough from a clean checkout. Each requirement from the brief maps to a command and
the result to expect. If port 4000 is taken, keep `ROUTER_PORT=4100` as below; otherwise
leave it out.

## 0. One-time setup

```sh
git switch main && git pull
nvm use                 # Node 24, from .nvmrc
corepack enable         # provides pnpm 9
pnpm install
```

## 1. Everything that does not need Docker

```sh
pnpm check
```

Expect exit code 0 and 94 unit tests passing (12 global-id, 32 governance, 22 node, 5
product, 23 Rust). The governance summary lists `composition`, `node-rules`, `operations`,
`breaking-changes`, `policy` and `decisions` as `pass`. This includes the Rust `fmt`, `clippy`
and tests, so it needs `rustup`; the first Rust build takes a few minutes.

## 2. Run the stack

```sh
export ROUTER_PORT=4100 ROUTER_URL=http://localhost:4100/graphql
docker compose up --build --wait
```

The first build takes about ten minutes (the router is a Rust release build); later builds
reuse the cache. When the command returns, all three services are healthy.

## 3. Verify each requirement

| Requirement | How to check | Expect |
|---|---|---|
| Anonymous requests are allowed in | `curl -s $ROUTER_URL -H 'content-type: application/json' -d '{"query":"{ products(first:1){ edges{ node{ name } } } }"}'` | data returned with no token |
| `@requiresScopes`, `reject` mode | the same query also asking for `internalCost`, no token | `UNAUTHORIZED_FIELD_OR_TYPE`, HTTP 403, no data |
| A token with the scope works | `T=$(node scripts/mint-token.mjs --sub alice --scope catalog:read:internal)`, then the same query with `-H "authorization: Bearer $T"` | `internalCost` returned |
| Forged, expired and malformed tokens grant nothing | `node scripts/smoke.mjs` | 12 `ok` lines, "all smoke checks passed" |
| `node(id)` resolves a Product and a Review | the first command below | the entity, with its fields |
| Unknown or malformed ids return `null` | the same command with `Product:no-such-product` or `###` | `{"data":{"node":null}}` |
| Relay pagination and a result-union mutation | `products(first:2){ pageInfo{ endCursor } }`, then page with `after`; `addReview` with an unknown product id | typed `ProductNotFoundError` |
| Rate limit: allowed, rejected, recovery | the loop below, wait 10s, run it again | `200` x5 then `429`; after the wait `200` again |
| Two callers apart, anonymous caller, several limited fields, rejected work never reaches a subgraph | `node scripts/rate-limit-cases.mjs` (about 40s) | 21 `ok`, "all rate-limit cases passed" |
| Limits come from the supergraph and change without a restart | `node scripts/rate-limit-reload.mjs` | 4 `ok` |
| Request id forwarded to every subgraph | `node scripts/request-id-check.mjs` | 3 `ok` |

```sh
# node(id): encode a global id, then ask for it
ID=$(node -e 'console.log(Buffer.from("Product:trail-backpack").toString("base64url"))')
curl -s $ROUTER_URL -H 'content-type: application/json' \
  -d "{\"query\":\"{ node(id:\\\"$ID\\\"){ __typename id ... on Product { name } } }\"}"

# rate limit: six anonymous calls in a row (limit is 5 per 10s on Query.products)
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code} " $ROUTER_URL \
    -H 'content-type: application/json' -d '{"query":"{ products(first:1){ edges{ node{ name } } } }"}'
done; echo
```

To see that a rejected request never reached a subgraph:
`docker compose logs router | grep '"status_code":429'`. The rejected lines carry
`"subgraph_requests":0`.

Run the stack scripts one at a time. They share the rate-limit counters for anonymous callers,
and `rate-limit-cases.mjs` waits out a window first on purpose.

## 4. Governance, and the rename scenario from the brief

```sh
pnpm governance        # six checks, one summary
```

A pull request that renames a field a client operation uses must fail readably:

```sh
# 1. rename Product.name to title in the product subgraph
perl -pi -e 's/^    name: fieldBuilder\.exposeString\("name"\),/    title: fieldBuilder.exposeString("name"),/' subgraphs/product/src/schema.ts
pnpm graph:update
pnpm governance        # breaking-changes and operations FAIL, naming file:line and the operation

# 2. put it back
git checkout -- subgraphs supergraph
pnpm graph:update && pnpm governance
```

The failure names the file, line and column, the operation, and the branch the operation
exists on. What this check does and does not guarantee is in
[ADR 0007](decisions/0007-schema-governance.md).

## 5. Adding a Node type in another subgraph

```sh
git status --short     # must print nothing: the script restores files with git checkout
node e2e/add-node-type/run.mjs
```

Expect 10 `ok` lines ending in "add-node-type scenario passed". It shows a Node type nobody can
resolve being rejected (rule N2), then a new type resolving through the router, with only the
node subgraph's two generated files changed. It restores everything afterwards.

## 6. CI and documentation

- GitHub, Actions tab: all nine jobs (`check`, `composition`, `node-rules`, `operations`,
  `breaking-changes`, `policy`, `decisions`, `stack`, `add-node-type`) should be green.
- [docs/workflow.md](workflow.md): ticket to pull request. [decisions](decisions/README.md): the
  written reasoning. [LLM-USAGE.md](../LLM-USAGE.md): the declaration.

## 7. Tear down

```sh
docker compose down
```
