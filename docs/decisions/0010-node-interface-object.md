# 0010 - node(id) as an interface object

Status: accepted. Supersedes [0004](0004-node-subgraph.md).

## Context

ADR 0004 made the node subgraph's schema and an `owners.json` *generated* from the other
subgraphs' schemas, so a new entity type changed two committed files in the node subgraph (by a
workflow, never by hand). The brief now asks that `node(id)` "keeps working when a new entity type
appears anywhere in the graph, with no change to shared code". A regenerated committed file in a
shared subgraph is still a change there. Federation has a known pattern for exactly this:
an entity interface plus `@interfaceObject`.

## Decision

- **The node subgraph is static and knows no types.** `type Node @key(fields: "id") @interfaceObject`
  plus `Query.node(id: ID!)`. `Node` there stands for every type that implements `Node` anywhere.
- **Each owning subgraph declares `interface Node @key(fields: "id")` and resolves it:** given a bare
  id it returns the concrete entity (with its `__typename`) or `null` if the id is not one of its
  own. Types implement `Node` and carry `@key(fields: "id")`, as before (ADR 0002).
- **The router does the routing.** `node(id)` returns a bare `{ id }`; the router asks the owners'
  entity interface which concrete type it is and fetches the requested fields from that owner.
- **Unknown ids return `null`, through an owner probe.** Found by a spike against the real router:
  when no owner recognises an id, the router does not return `null`, it returns
  `{ "__typename": "Node", "id": "..." }`, a stub typed with an interface name that no entity can
  have. So `Query.node` first asks the owners the same question the router will ask, and returns
  `null` if none recognises the id. Malformed ids return `null` without asking anyone.
- **The probe finds owners in the live supergraph**, not in configuration: every subgraph that
  declares the `Node` interface as an entity interface, minus the interface object itself
  (`packages/owner-check` asks; `subgraphs/node/src/owners.ts` reads the list). The file is the one
  the router follows, mounted read-only, and is compared by content on every call so a recomposed
  supergraph is seen at once. New types and new subgraphs both need no configuration here.
- **Rules are static checks in governance** (`governance/src/node-rules.ts`, job `node-rules`):
  an implementing type has `id: ID!` and a resolvable `@key(fields: "id")`; a subgraph with such
  types declares `interface Node @key(fields: "id")`; `Node` is exactly `{ id: ID! }` everywhere; one
  subgraph serves `Query.node` through the interface object; no reserved type names.

## Consequences

- Adding an entity type, or a whole subgraph, changes nothing under `subgraphs/node`. The
  add-a-Node-type scenario asserts that `git status` shows nothing there.
- The generator, `owners.json` and the node discovery code are gone.
- Each owner implements the interface-level resolver (id to concrete entity or null). Cheap, but it
  is code every owning subgraph carries.
- An existing id costs the owner two questions: the probe and the router's own resolution. Unknown
  ids cost the probe only. Fine at this scale; a production system might drop the probe by making
  the router return `null` for an unresolved interface object, or cache positive answers.
- The node subgraph calls owners directly (bypassing router auth). That is safe only because the
  probe returns nothing but `__typename`; owners must not add sensitive data to it.
- It leans on the router's interface-object support. Hive Router 0.3.10 handled it in the spike and
  in CI; a router without it would force a return to ADR 0004's design.
