# 0001 - Repository layout

Status: accepted

## Context

The brief asks for one repository holding a pnpm workspace and a Rust crate for the
router binary, with one local command and one CI pipeline running the same checks.

## Decision

```
subgraphs/   TypeScript subgraphs, one pnpm package each (product, node)
governance/  composition, breaking-change check, policy lint, decision checks
router/      Rust crate: Hive Router binary with the @rateLimit plugin
docs/        decisions (ADRs), change workflow
scripts/     small helper scripts (token minting, etc.)
```

- `pnpm check` is the single entry point. Each package exposes its own `check`
  script and the root runs them all with `pnpm -r --if-present`. CI calls the same
  command, so a green local run means a green pipeline.
- Rust lives outside the pnpm workspace; it is built and tested with cargo and
  wired into `pnpm check` by a script once the crate exists.
- Decisions are recorded as short numbered files in `docs/decisions/` as they are
  made, not reconstructed at the end.

## Consequences

Adding a subgraph is a new folder under `subgraphs/` with a `check` script; nothing
at the root needs to change.
