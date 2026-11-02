# Instructions for coding agents

This repo is a pnpm workspace (`subgraphs/*`, `governance`) plus a Rust crate
(`router/`). Read `README.md` and `docs/decisions/` before changing anything.

## Ground rules

- Run `pnpm check` before declaring work done. It is the same command CI runs.
- Never hand-edit generated files (schemas, supergraph, node-subgraph artifacts).
  Change the source and regenerate.
- Record any design decision as a new numbered file in `docs/decisions/`.
- Keep `LLM-USAGE.md` accurate: if you generate code, say so for that part.
- Commits: small, one logical change each, plain imperative messages, no
  co-author or tool trailers, no rewriting or backdating history.
- Do not add dependencies without a reason; mention the reason in the commit body.

## Where things go

- New subgraph: folder under `subgraphs/` with a `check` script.
- New policy or decision check: `governance/`, with a failing fixture.
- Router changes: `router/`; limits come from the supergraph, never from Rust source.
