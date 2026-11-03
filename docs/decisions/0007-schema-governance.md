# 0007 - Schema governance

Status: accepted

## Context

Several teams change a shared graph every week and rely on automated checks to release.
One local command must run all schema governance, CI must run it on every pull request,
a PR that renames a field a client uses must fail readably, and each check must report
its own failure.

## Decision

`pnpm governance` runs six checks and prints a pass/fail summary; it does not stop at
the first failure. The same checks run as separate CI jobs (below), so each shows up as
its own status on the PR. `pnpm check` includes them.

| Check | What it does | Where |
|-------|--------------|-------|
| `composition` | composes the subgraphs; fails on composition errors or when the committed `supergraph.graphql` is stale | `governance/src/compose.ts` |
| `node-rules` | rules N1 to N4 for Node types (ADR 0004) and a stale node subgraph | `subgraphs/node` |
| `operations` | every operation in `clients/operations` on **this branch** validates against the proposed API schema | `governance/src/cli/operations.ts` |
| `breaking-changes` | every operation in `clients/operations` on the **target branch** validates against the proposed API schema | `governance/src/cli/breaking.ts` |
| `policy` | schema policy rules on the API schema | `governance/src/policy.ts` |
| `decisions` | `@requiresScopes` and `@rateLimit` rules from ADR 0003 and ADR 0006 | `governance/src/decisions.ts` |

Every violation has a stable rule id, a location (`file:line:column` or a schema
coordinate) and a message that says what to do. Each rule has a failing fixture in
`governance/fixtures/`.

### Breaking-change detection: what it guarantees and what it does not

The check takes the client operations committed on the target branch (read with
`git show <base>:clients/operations/...`) and validates them against the proposed API
schema with the standard GraphQL validation rules.

**It guarantees** that every operation checked in on the target branch is still valid
GraphQL against the new schema: fields and arguments exist, required arguments are still
supplied, variable types still fit the arguments they feed, fragment type conditions
still apply, leaf and composite selections are still correct. Renaming or removing a
field, type or argument that a checked-in operation uses fails the check, and so does
making an argument required.

**It does not guarantee**

- anything about clients whose operations are not checked in (mobile apps in the wild,
  partners, ad-hoc scripts). Coverage is only as good as `clients/operations`;
- that data means the same thing. A field that keeps its name and type but returns
  different values, or a changed default, passes;
- that output nullability changes are safe. `String!` becoming `String` still validates,
  but clients that assume non-null will break;
- that variable *values* remain valid: removing an enum value breaks a client that sends
  it through a variable, and operations only show literals;
- that access is unchanged: new `@requiresScopes` or a tighter `@rateLimit` do not fail it;
- performance or cost of the operations.

A removed enum value, a changed nullability and a removed deprecated field with no
operation using it are therefore the cases it cannot see. Closing them means a schema
diff tool (for example graphql-inspector) alongside this check, plus usage data from
real traffic. Not attempted here.

### Policy rules (on the API schema)

1. **`policy/mutation-result-union`** - a mutation returns a union named `...Result`
   containing a success type and at least one type named `...Error`. Clients can then
   handle expected failures with a typed `__typename` switch instead of parsing error
   strings.
2. **`policy/relay-connection-shape`** - a field returning `...Connection` takes
   `first/after` and/or `last/before`; the connection has `edges` and `pageInfo:
   PageInfo!`; the edge has `node` and `cursor: String!`. Keeps pagination uniform so
   one client helper works everywhere.
3. **`policy/naming-convention`** - PascalCase types, camelCase fields and arguments,
   SCREAMING_SNAKE_CASE enum values, input types named `...Input`.

These are written against `graphql-js` directly instead of `graphql-eslint`. Three rules
do not justify an ESLint toolchain, and plain functions over a `GraphQLSchema` are easy
to read and to give a fixture each. If the rule count grows, moving to graphql-eslint is
the obvious step.

### Decision checks

- **`decisions/requires-scopes-placement`**: object-type fields only; never on a type,
  on an interface field, or on `Query.node`.
- **`decisions/requires-scopes-single-list`**: exactly one scope list (all scopes required).
- **`decisions/scope-vocabulary`**: every scope matches `<domain>:<action>:<sensitivity>`
  and is listed in `governance/scopes.json`, so a new scope is a reviewed change.
- **`decisions/rate-limit-placement`**: object-type fields only, and not on a field that
  implements an interface field (the gateway would not count a call made through the
  interface; this closes the limitation recorded in ADR 0006).
- **`decisions/rate-limit-arguments`**: the same argument rules the router enforces, so a
  bad `@rateLimit` fails the PR instead of the router refusing the supergraph at load.

## Branch protection

A failing check only blocks a merge if GitHub is told to require it. For `main`:

1. Require a pull request before merging (at least one approving review; dismiss stale
   approvals when new commits are pushed).
2. Require status checks to pass, and select **these jobs**: `check`, `composition`,
   `node-rules`, `operations`, `breaking-changes`, `policy`, `decisions`, `stack`,
   `add-node-type`.
3. Require branches to be up to date before merging. `breaking-changes` compares
   against the target branch, so a PR that was green against an older `main` must be
   re-checked against the current one.
4. Do not allow force pushes or deletions on `main`, and include administrators.

Required checks must run on every PR: the workflow has no path filters for that reason,
because a skipped required job counts as passing for some configurations and leaves a
PR pending for others.

## Consequences

- Adding a client operation is how a team puts a field under protection; the README says so.
- The checks run in seconds and need no network or running services.
- `breaking-changes` needs the target branch available (`fetch-depth: 0` in CI) and
  fails, rather than skipping, if it cannot find it.
