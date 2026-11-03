# Decisions

Short numbered records, written when each decision was made. Status is `accepted` unless noted.

| # | Decision | Answers |
|---|----------|---------|
| [0001](0001-repo-layout.md) | Repository layout | one local command, one CI pipeline, where things go |
| [0002](0002-global-ids.md) | Global ids | encoding, relation to the federation key, referring to entities a subgraph does not own |
| [0003](0003-authorization.md) | Authorization with `@requiresScopes` | scope vocabulary, protected fields and placement, denial mode |
| [0004](0004-node-subgraph.md) | Node subgraph | discovering eligible types, routing an id to its owner, rejecting unresolvable declarations |
| [0005](0005-composition-and-gateway-wiring.md) | Composition and gateway wiring | composition library, supergraph, JWT, activating a new supergraph, request id |
| [0006](0006-rate-limits.md) | Rate limits | directive arguments, caller identity, counting, window, rejection, memory bound |
| [0007](0007-schema-governance.md) | Schema governance | the six checks, what breaking-change detection guarantees, branch protection |

To record a new decision, add the next number, keep it to context, decision, trade-offs, and
link it here. Decisions that change an earlier one say so in both files.
