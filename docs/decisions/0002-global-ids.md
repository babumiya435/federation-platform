# 0002 - Global ids

Status: accepted

## Context

Every Node entity needs an opaque, globally unique id that `Query.node(id: ID!)`
accepts. We must choose the encoding, its relationship to the federation key, and
how a subgraph refers to an entity it does not own.

## Decision

**Encoding.** `id = base64url("<TypeName>:<localId>")`, implemented once in
`packages/global-id` and shared by every subgraph. Decoding is strict: anything that
is not canonical base64url, has no separator, an invalid type name or an empty local
part decodes to `null`.

**Opaque, not secret.** Clients must not parse ids, but nothing is signed or
encrypted. Authorization never depends on an id being unguessable.

**Federation key.** The key of every Node type is the global id itself:
`@key(fields: "id")`. There is no second `localId` key field.

**Referring to entities we do not own.** A subgraph that does not own `Product`
returns the stub `{ __typename: "Product", id }`; the router fetches the rest from
the owner through `_entities`. The node subgraph relies on exactly this: it decodes
the id, takes the type name, and returns a stub. It never loads data itself.

## Why

- One key means one id in client queries, in `_entities` representations and in
  `node(id:)`. No mapping layer to keep consistent.
- Putting the type name inside the id lets the node subgraph validate an id (known,
  eligible type) without calling any owner.
- Unknown-but-well-formed ids reach the owner, whose `resolveReference` returns
  `null`, so `node` returns `null` as the brief requires.

## Consequences and trade-offs

- Renaming a GraphQL type changes every id of that type. Ids are only stable while
  type names are. Acceptable here; a production system would keep a stable
  type tag separate from the schema name.
- Anyone can forge an id for any type. That is fine because resolvers and
  `@requiresScopes` enforce access, not the id.
- The local id may contain `:`; only the first `:` separates the type name.
