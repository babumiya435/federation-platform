# Change workflow: from ticket to a pull request that passes

The same steps apply whether a person or a coding agent does the typing. Agent-specific
rules are in [AGENTS.md](../AGENTS.md).

## The steps

1. **Branch** from an up-to-date `main`: `git switch -c <short-topic>`.
2. **Change the source.** Subgraph schemas come from code (`subgraphs/product/src/schema.ts`),
   never from editing `schema.graphql`. Limits and scopes are directives in that code.
3. **Regenerate** whatever is derived: `pnpm graph:update`. It rewrites the subgraph
   schemas and `supergraph/supergraph.graphql`. Commit the result in the same change.
4. **Protect what clients use.** If a client starts using a field, add an operation that
   uses it to `clients/operations/`. That is what makes later renames fail the
   `breaking-changes` check.
5. **Check locally:** `pnpm check` (everything CI runs), or `pnpm governance` for just the
   schema checks. If you touched the router, a limit or auth, also start the stack
   (`docker compose up --build`) and run the scripts in the README.
6. **Record the decision** if you made one: a new numbered file in `docs/decisions/`, linked
   from its index. If you used an agent, update [LLM-USAGE.md](../LLM-USAGE.md) for the part
   you changed.
7. **Commit** in small logical steps with plain imperative messages (what changed and why
   it was needed). Do not rewrite or backdate history.
8. **Open the pull request.** The template lists what to confirm. CI runs nine jobs; each
   shows up as its own status.
9. **Fix what a job names**, push, repeat. Merge when every required check is green and a
   reviewer approves.

## When a check fails

| Job | It means | Usual fix |
|-----|----------|-----------|
| `check` | something in `pnpm check` failed: tests, generated files out of date, or the router's `fmt`, `clippy` or tests | read the first failing line; run `pnpm graph:update` for a stale-file message; `cargo fmt` in `router/` |
| `composition` | the subgraphs do not compose, or `supergraph.graphql` is stale | fix the schema conflict named, then `pnpm graph:update` |
| `node-rules` | the Node pattern is broken in a subgraph | the message names the rule, subgraph and type: give the type `id: ID!` and a resolvable `@key(fields: "id")`, and declare `interface Node @key(fields: "id")` in that subgraph |
| `operations` | an operation in `clients/operations` does not validate against the schema | fix the operation, or the schema change that broke it |
| `breaking-changes` | an operation **on the target branch** would stop validating | keep the field (deprecate it first and migrate clients), do not edit the operation to match |
| `policy` | the API schema breaks a policy rule (`policy/...`) | the message says what to change: result union, connection shape or naming |
| `decisions` | `@requiresScopes` or `@rateLimit` is misplaced or malformed (`decisions/...`) | object-type fields only; scopes must be in `governance/scopes.json`; check the arguments |
| `stack` | the built stack fails a script | the job prints the compose logs; reproduce with `docker compose up --build` and the script that failed |
| `add-node-type` | adding a Node type no longer works end to end | run `node e2e/add-node-type/run.mjs` locally (needs a clean tree) |

## Recipes

**Add a subgraph.** Create `subgraphs/<name>` with a `check` script (copy `subgraphs/reviews`: it
shows an entity it owns, a reference to another subgraph's entity, and a mutation), add
`{ name, url }` to `governance/subgraphs.json`, add a compose service (the `healthcheck` anchor
and a unique `PORT` are the only fiddly parts), and run `pnpm graph:update`. If it declares
`@rateLimit`, use `packages/rate-limit-directive` so composition keeps the directive.

**Add a Node type in another subgraph.** In that subgraph, make the type implement `Node` with
`id: ID!` and `@key(fields: "id")`; if the subgraph has no Node types yet, also declare
`interface Node @key(fields: "id")` and give it a resolver that turns a bare id into the concrete
entity (with its `__typename`) or `null` (copy `subgraphs/reviews`). Run `pnpm graph:update`.
Nothing under `subgraphs/node` changes, ever.

**Add or change a rate limit.** Change the `@rateLimit(limit, windowSeconds, cost)` arguments
on the field in the subgraph code, run `pnpm graph:update`. The router's source does not
change; a running router picks up the new supergraph within its poll interval (5s).

**Add a scope.** Add it to `governance/scopes.json` with a description (format
`<domain>:<action>:<sensitivity>`) in the same change that uses it in `@requiresScopes`.

**Remove or rename a field.** Deprecate first. Remove it only after the operations in
`clients/operations` that use it are gone from the target branch.

## Without an agent

Nothing above needs one. With one, the human steps that remain are the review of design
decisions in the ADRs, deciding what goes in `clients/operations/`, merging, and keeping
`LLM-USAGE.md` true.
