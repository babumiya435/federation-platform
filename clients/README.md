# Client operations

The GraphQL operations our clients send, checked in so the schema checks can run them.

- `pnpm --filter @federation-platform/governance check:operations` validates these
  against the proposed schema.
- `check:breaking` validates the copy of this folder **on the target branch** against
  the proposed schema, so a pull request cannot break an operation that is already in use.

Add an operation here when a client starts using a field. One operation per file, named
like the operation. See docs/decisions/0007-schema-governance.md for what the check does
and does not guarantee.
