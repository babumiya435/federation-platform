# 0006 - Rate limits: `@rateLimit`

Status: accepted

## Context

A `@rateLimit` directive on fields, enforced by the gateway. We must define its
arguments, how a caller is identified (anonymous included), what one call counts as
when a field repeats or returns a list, the time window, and what a rejected call
returns. The directive must survive composition into the supergraph, limits must be
read from the supergraph (no router source change to add or change one), counted in
memory with a bound, and enforced before any subgraph is called.

## Decision

**Directive.**

```graphql
directive @rateLimit(limit: Int!, windowSeconds: Int!, cost: Int! = 1) on FIELD_DEFINITION
```

- `limit`: units allowed per caller per window, `>= 1`.
- `windowSeconds`: window length, `1..=86400`.
- `cost`: units one occurrence of the field consumes, `1..=limit`.
- Allowed on fields of **object types** only (not interface fields).

It is declared in the owning subgraph with
`@link(url: "https://platform.local/rate-limit/v1.0", import: ["@rateLimit"])` and
`@composeDirective(name: "@rateLimit")`, which is what makes composition carry it into
the supergraph. Without `@composeDirective` the directive is silently dropped.

**Where limits come from.** The plugin walks the supergraph document each time the
router loads one (`on_supergraph_reload`) and builds a `(type, field) -> rule` table.
A new supergraph is picked up by the router's file polling (ADR 0005); the plugin
swaps its table when that load succeeds, so adding or changing a limit needs no change
to the router's source and no restart. A `@rateLimit` with bad arguments fails the
supergraph load with a message, so the router keeps the previous, valid supergraph
rather than running with a limit nobody can read.

**Caller identity.** The JWT `sub` claim when the request carries a valid token;
otherwise the socket peer IP address. We deliberately ignore `X-Forwarded-For`: the
router is the edge here, and trusting that header would let any anonymous caller pick
a new identity per request. A token that validates but has no `sub` is treated as
anonymous. Consequence: behind a reverse proxy all anonymous callers share the
proxy's address until a trusted-proxy setting exists (future work). Each (caller,
field) pair has its own counter, so limits on different fields are independent.

**What one call counts as.** Counted per *occurrence in the operation*, before
execution:

- every occurrence of a limited field consumes `cost` units, so `a: products b: products`
  consumes 2 and aliases cannot be used to dodge a limit;
- identical fields with the same response key (`products products`, or the same fragment
  spread twice) are merged by GraphQL before the router calls plugins. They run once, so
  they cost once. This was found by testing, not assumed;
- fields inside inline and named fragments are counted;
- the size of a returned list does not matter (the result is unknown at this point);
  paginating costs one unit per request;
- `@skip` / `@include` are ignored: a conditionally skipped field still counts.
  Over-counting is the safe direction.

**Window.** Fixed window per (caller, field): it starts at the first counted request
and resets `windowSeconds` later. Cheap (one counter) and easy to explain; the known
weakness is that a caller can use up to `2 x limit` across a window boundary.

**Whole request or only the affected fields: the whole request.** If any limited
field in the request is over its limit, the request is rejected and **nothing is
counted for any field** (all-or-nothing under one lock). That avoids half-executed
operations (for instance a mutation running while the query next to it is refused)
and makes retries simple. Because the check runs in the router's analysis phase,
before query planning, a rejected request never reaches a subgraph.

**What a rejected call returns.** HTTP `429`, no `data`, one error per exceeded field:

```json
{"errors":[{"message":"Rate limit exceeded for Query.products: 5 per 10s.",
  "extensions":{"code":"RATE_LIMITED","field":"Query.products","limit":5,
  "windowSeconds":10,"retryAfterSeconds":7}}]}
```

A request that needs more units than `limit` in a single request (for example 6
aliases against a limit of 5) can never succeed; the message says so.
`Retry-After` as an HTTP header is not set: the analysis hook cannot add headers.
`retryAfterSeconds` carries the same information.

**Memory bound.** At most `max_buckets` counters (default 10 000, plugin config).
When full, expired windows are dropped first, then the counter with the oldest window
is evicted. Under pressure the limiter therefore fails *open* for the evicted caller
(their counter restarts) instead of refusing new callers. Anyone who can create enough
distinct identities to force evictions can already bypass per-caller limits.

**With two router replicas** each replica counts independently, so the effective
limit is `limit x replicas` (and depends on how the load balancer spreads a caller).
Shared counters would need an external store (Redis or similar) and a decision about
failing open or closed when it is down. Out of scope here.

## How this was checked

Unit tests in `router/src/rate_limit/` cover the limiter (limit, recovery, two callers,
all-or-nothing, bound and eviction, an impossible request), the operation counting
(aliases, fragments, nesting, `@skip`) and the directive parsing (every bad-argument
case). `scripts/rate-limit-cases.mjs` runs against the real stack: allowed and rejected
calls, recovery after the window, two callers kept apart, an anonymous caller, one
request with several limited fields, and a refused mutation that is shown not to have
run. Rejected requests appear in the router log with `subgraph_requests: 0`.
`scripts/rate-limit-reload.mjs` edits the supergraph the router is polling and shows a
changed limit taking effect with no restart; an invalid `@rateLimit` is reported by the
router as `Failed to build new supergraph data: Error from plugin: Invalid @rateLimit:
...` and the previous limits stay in force.

## Known limitations

- Enforced only when the field is selected on its object type. A limited field reached
  through an interface or union selection (without a type condition) is not counted.
  The decision checks in the governance batch forbid `@rateLimit` on fields that
  implement interface fields, which closes this.
- The fixed-window boundary burst above.
- One mutex guards the counters. Fine for this exercise; sharding is the first step
  if it ever shows up in a profile.
