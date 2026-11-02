# 0003 - Authorization with @requiresScopes

Status: accepted (denial mode and placement rules are enforced by checks in batch 5)

## Context

The router's built-in `@requiresScopes` must protect some fields. We choose the
scope vocabulary, which fields are protected and where the directive sits, and which
denial mode the router runs with.

## Decision

**Vocabulary.** `<domain>:<action>:<sensitivity>`, lower-case, colon separated.

| Scope                   | Grants                                  |
|-------------------------|-----------------------------------------|
| `catalog:read:internal` | Internal commercial data on catalogue types |
| `reviews:read:pii`      | Personal data on reviews                |

Scopes come from the JWT `scope` claim (space separated), which is the router's
default. Anonymous callers carry no scopes.

**Protected fields.** `Product.internalCost` needs `catalog:read:internal`;
`Review.authorEmail` needs `reviews:read:pii`. Both are non-null fields.

**Placement.** On object-type fields only, in the subgraph that owns the field.
Never on interfaces (the router rejects that) and never on the `Node` interface or
`Query.node`, so the node subgraph stays free of product policy: protection follows
the entity into `node(id)` because it lives on the owning type's fields. We use
single-list scopes (AND); no OR groups until a use case needs them.

**Denial mode: `reject`.** Our protected fields are non-null. In `filter` mode a
denied non-null field becomes `null`, and the null propagates to the nearest nullable
parent, so a caller asking `node(id) { ... on Product { internalCost } }` would get
`node: null` plus an error and could not tell "no such product" from "not allowed".
`reject` fails the whole request with no data, which is predictable and leaks nothing
by shape.

## Consequences

- A client that wants public fields only must not select protected ones.
- Unauthenticated requests are still accepted (`require_authentication: false`); only
  the protected fields refuse them.
- Switching to `filter` later would mean making protected fields nullable first.
