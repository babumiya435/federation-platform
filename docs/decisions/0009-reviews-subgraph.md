# 0009 - Reviews in their own subgraph

Status: accepted

## Context

The brief asks for two or more TypeScript subgraphs that *own different types*, with a
reference across the boundary. Until now `Product` and `Review` lived in one subgraph and the
only other subgraph (node) owned no types, so nothing in the graph was actually split.

## Decision

- **`subgraphs/product`** owns `Product` and the Relay-paginated `Query.products`.
- **`subgraphs/reviews`** owns `Review` and the `addReview` mutation with its result union, and
  extends `Product` with `reviews`.
- **References cross the boundary both ways.** `Review.product` is a reference: the reviews
  subgraph knows only the product's id and the router fetches the rest from the product subgraph.
  `Product.reviews` goes the other way: the router sends the product's id to the reviews subgraph.
  Both use the shared id as the federation key (ADR 0002).
- **The public API did not change.** Composition produces the same client-facing schema, so
  client operations and `breaking-changes` are unaffected (checked: the target branch's
  operations still validate).

**`addReview` and products.** The mutation must not store a review for a product that does not
exist, but the reviews subgraph does not own products. It asks the product subgraph, with the
same `_entities` question the node subgraph asks (`packages/owner-check`, one shared
implementation), and forwards the request id. If the product subgraph is down it answers
`PRODUCT_LOOKUP_UNAVAILABLE` with a safe message and logs the detail: reporting "no such
product" for an outage would be false. Alternatives rejected: skipping the check and letting
`Review.product` fail on read later (it would store orphan reviews), and calling through the
router (a subgraph must not depend on the gateway).

**Shared declaration of `@rateLimit`.** Both subgraphs use it, so the directive definition, its
spec link and `@composeDirective` live once in `packages/rate-limit-directive`. Composition drops
a custom directive silently unless all three are present in every subgraph that uses it.

**Who owns a Node type.** With two subgraphs describing `Product`, "owner" needs a definition: a
subgraph owns a Node type when it declares `implements Node` on it and can resolve it by id.
`reviews` can resolve any `Product` id (it only needs the id to add `reviews`), so counting it as
an owner would make the node subgraph answer "exists" for every product id. ADR 0004 is updated.

## Consequences

- Writes depend on the product subgraph being up (the existence check); reads do not.
- A query like `products { reviews { product { name } } }` makes three subgraph calls
  (product, reviews, product). `scripts/boundary-check.mjs` proves it in CI from the router's own
  log (`involved_subgraphs`, `subgraph_requests`).
- Adding the next subgraph is a folder, an entry in `governance/subgraphs.json` and a compose
  service; `docs/workflow.md` has the steps.
