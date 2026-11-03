# 0005 - Composition and gateway wiring

Status: accepted

## Context

The graph must be composed into a supergraph that Hive Router loads from a file,
with JWT validation against a key set checked into the repo, anonymous callers
allowed, and a script that mints tokens.

## Decision

**Composition library: `@theguild/federation-composition`.** Pure JavaScript, runs in
the same Node toolchain as the rest of the workspace, needs no extra binary and no
network. Rover was the alternative; it needs a platform binary in CI and Docker for
no gain at this size. Composition errors are printed with their codes, one per line.

**One supergraph, committed.** `governance/src/compose.ts` reads
`governance/subgraphs.json` (name and URL per subgraph) and each subgraph's
committed `schema.graphql`, and writes `supergraph/supergraph.graphql`. `pnpm check`
fails if the committed file is stale or composition fails. A subgraph directory that
is missing from the registry is an error, so a subgraph can never be silently left
out.

**Subgraph URLs are the compose network names** (`http://product:4001/graphql`), so
the committed supergraph is correct for `docker compose up` and for CI.

**How an updated supergraph becomes active.** The router runs with
`supergraph.source: file` and `poll_interval: 5s`. The file is bind-mounted, so
recomposing and saving it is picked up on the next poll with no restart and no change
to the router's source. Verified by editing the mounted file: the router logged
"supergraph loaded successfully with changes" within one poll interval, and again when
the file was restored. (Behaviour under a bad file is covered with the rate-limit
tests.)

**JWT.** ES256, keys from a committed JWKS file (`auth/dev-jwks.json`).
`require_authentication: false` lets anonymous requests in; protected fields refuse
them through `@requiresScopes` (ADR 0003). `scripts/mint-token.mjs` signs tokens
with the matching private key.

**What the router does with tokens (observed, not assumed).**

| Token | Result |
|-------|--------|
| valid, has the scope | protected field served |
| valid, lacks the scope | protected field refused |
| no token | public fields served, protected refused |
| tampered signature, swapped payload, garbage, `alg: none` | treated as anonymous: public fields served, protected refused, no scopes ever granted |
| expired by more than ~60s | same as anonymous |
| expired by less than ~60s | still accepted (the router's default clock leeway; not configured by us) |

A denied request returns HTTP 403 with `UNAUTHORIZED_FIELD_OR_TYPE` and `data: null`
(`reject` mode, ADR 0003). An invalid token does not by itself cause a 401, because
`require_authentication` is false; it just never grants anything.

**Request id.** The brief asks for a request id forwarded from the router to each
subgraph. The router decides a request's id before plugins run (the client's
`x-request-id` if it is short and made of safe characters, otherwise a generated one)
and logs it. Header rules alone cannot forward a *generated* id: nothing in the router's
header rules or VRL context exposes it. So the `request_id` plugin reads the router's id
from the router's own request scope and writes it back into the request's
`x-request-id` header, and `headers.all.request` propagates that header to every
subgraph. The id in the router log is then the id every subgraph receives, including
when the client sent none or an unusable one. The first attempt generated a second id in
the plugin and the two differed; `scripts/request-id-check.mjs` caught that. Subgraphs
log one JSON line per GraphQL call with the id they received, and the node subgraph
passes it on to the owner it asks. Nothing beyond forwarding the id is attempted
(no tracing, no metrics).

## Dev keys are committed on purpose

The private key (`auth/dev-private-key.jwk.json`) is in the repo so the stack and CI
run with no secrets. It is only trusted by this local stack. Anything real needs its
own keys, a remote JWKS and rotation; none of that is attempted here.

## Consequences

- Any schema change shows up in a PR as a diff of `supergraph.graphql`.
- Because the JWKS is a static file, rotating keys means editing the file; the router
  does not poll it as it would a remote provider.
