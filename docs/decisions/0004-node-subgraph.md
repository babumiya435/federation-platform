# 0004 - Node subgraph: discovery, routing, rejection

Status: accepted

## Context

The node subgraph owns `Query.node(id: ID!): Node`. Product and Review implement
Relay's `Node`. We must decide how it discovers eligible types, routes an id to its
owner, and rejects declarations it cannot resolve. A new Node type added in another
subgraph must work through `node(id)` without anyone editing the node subgraph by
hand.

## Decision

**Discovery.** A type is eligible when it is an object type that `implements Node` in
any other subgraph's committed `schema.graphql`. The node subgraph's own
`schema.graphql` is a *derived artifact*: `pnpm graph:update` regenerates it from the
other subgraphs' schemas, and `pnpm check` fails if it is stale. Nobody edits it.

**Routing.** The generated schema declares every eligible type as a non-resolvable
stub (`@key(fields: "id", resolvable: false)`). A second generated artifact,
`owners.json`, maps each type to the URL(s) of the subgraphs that declare a resolvable
`@key(fields: "id")` on it. `node(id)`:

1. decodes the id (ADR 0002); malformed ids return `null`;
2. returns `null` if the decoded type name is not a possible type of `Node` in its
   own schema (no owner is called);
3. asks each owner whether it has the entity (`_entities` for `{ __typename, id }`;
   owners answer `null` for ids they do not know) and returns `null` if none does;
4. otherwise returns the stub `{ __typename, id }`, and the router fetches the
   selected fields from the owner(s) as it would for any entity.

The owner check is there because of how the router plans queries: for
`node(id) { __typename id }` every selected field is provided by the node subgraph, so
the router would never ask the owner and a well-formed id for a missing product would
come back as a stub. We tried marking the stub's `id` `@external` to force an owner
fetch; composition rejects it as unsatisfiable. If an owner is down, is slow (2s
timeout) or errors, `node` returns a GraphQL error (`NODE_OWNER_UNAVAILABLE`, safe
message, detail in the server log) rather than `null`, so an outage is not reported as
"no such entity". The request id header is forwarded to the owner.

**Rejection (rules checked before anything is generated).**

| Rule | A type that implements `Node` must... |
|------|---------------------------------------|
| N1 | be an object type with a field `id: ID!` |
| N2 | have at least one subgraph declaring a *resolvable* `@key(fields: "id")` on it, otherwise the router cannot resolve it |
| N3 | not use a reserved name (`Node`, `Query`, `Mutation`, `Subscription`) |
| N4 | (interface) every `Node` declaration must be exactly `interface Node { id: ID! }` |

Violations fail `graph:update` and `check` with a message naming the rule, the type
and the subgraph. Fixtures under `subgraphs/node/fixtures/` prove each rule fires.

## Consequences and trade-offs

- Adding a Node type is: implement `Node` and key it by `id` in the owning subgraph,
  run `pnpm graph:update`. The node subgraph file changes, by machine.
- Several subgraphs may contribute fields to one Node type; only N2's "at least one
  resolvable key" is required, not a single owner. We rely on federation composition
  to reject conflicting field definitions.
- The generated artifact adds churn to PRs that add Node types, which is deliberate:
  reviewers see exactly which types became reachable through `node(id)`.
- Cost: one extra owner round-trip per `node(id)` call, before the router's own fetch.
  Fine at this scale; a production system might cache positive answers briefly or push
  the existence check into the router.
- The node subgraph calls owners directly, bypassing the router's auth. That is safe
  only because the check returns nothing but `__typename`; owners must not add
  sensitive data to that response.
- Discovery reads committed schema files, not running services, so it works offline
  and in CI.
