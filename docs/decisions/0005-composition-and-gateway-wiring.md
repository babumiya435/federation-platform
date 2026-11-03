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

## Dev keys are committed on purpose

The private key (`auth/dev-private-key.jwk.json`) is in the repo so the stack and CI
run with no secrets. It is only trusted by this local stack. Anything real needs its
own keys, a remote JWKS and rotation; none of that is attempted here.

## Consequences

- Any schema change shows up in a PR as a diff of `supergraph.graphql`.
- Because the JWKS is a static file, rotating keys means editing the file; the router
  does not poll it as it would a remote provider.
