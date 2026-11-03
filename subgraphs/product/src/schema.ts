import SchemaBuilder from "@pothos/core";
import DirectivePlugin from "@pothos/plugin-directives";
import FederationPlugin from "@pothos/plugin-federation";
import RelayPlugin, { resolveArrayConnection } from "@pothos/plugin-relay";
import { localIdFor } from "@federation-platform/global-id";
import { type RateLimitDirectiveTypes, rateLimitSchemaOptions } from "@federation-platform/rate-limit-directive";
import { ProductStore, type ProductRecord } from "./data.js";

/** Scope vocabulary: see docs/decisions/0003-authorization.md. */
export const SCOPES = {
  catalogInternal: "catalog:read:internal",
} as const;

export interface Context {
  store: ProductStore;
}

const builder = new SchemaBuilder<{
  Context: Context;
  FederationScopes: (typeof SCOPES)[keyof typeof SCOPES];
  DefaultFieldNullability: false;
  Directives: RateLimitDirectiveTypes;
  DefaultEdgesNullability: { list: false; items: false };
  DefaultNodeNullability: false;
}>({
  plugins: [DirectivePlugin, RelayPlugin, FederationPlugin],
  // Non-null unless a field has a reason to be null (see policy lint, batch 5).
  defaultFieldNullability: false,
  // Query.node / Query.nodes belong to the node subgraph, so the relay plugin must
  // not add its own.
  relay: {
    nodeQueryOptions: false,
    nodesQueryOptions: false,
    edgesFieldOptions: { nullable: { list: false, items: false } },
    nodeFieldOptions: { nullable: false },
  },
});

/**
 * Node is declared identically in every subgraph that implements it, as an entity interface:
 * the node subgraph hands the router a bare id and each owner says whether the id is one of its
 * entities and which concrete type it is (docs/decisions/0010-node-interface-object.md).
 */
const Node = builder.interfaceRef<{ id: string }>("Node").implement({
  fields: (fieldBuilder) => ({ id: fieldBuilder.id({ resolve: (node) => node.id }) }),
  resolveType: () => Product,
});

/**
 * This subgraph owns Product. Reviews live in their own subgraph, which adds `Product.reviews`
 * and refers back to a product by its id (docs/decisions/0009-reviews-subgraph.md).
 */
const Product = builder.objectRef<ProductRecord>("Product");

Product.implement({
  interfaces: [Node],
  fields: (fieldBuilder) => ({
    id: fieldBuilder.exposeID("id"),
    name: fieldBuilder.exposeString("name"),
    price: fieldBuilder.exposeFloat("price"),
    internalCost: fieldBuilder.exposeFloat("internalCost", {
      requiresScopes: [[SCOPES.catalogInternal]],
    }),
  }),
});

/** `id` is the federation key. Unknown or wrong-typed ids resolve to null. */
builder.asEntity(Product, {
  key: builder.selection<{ id: string }>("id"),
  resolveReference: (representation, context) => {
    const localId = localIdFor("Product", representation.id);
    return (localId && context.store.find(localId)) || null;
  },
});

/** The entity interface: a bare Node id resolves to a Product if, and only if, it is one of ours. */
builder.asEntity(Node, {
  key: builder.selection<{ id: string }>("id"),
  resolveReference: (representation, context) => {
    const localId = localIdFor("Product", representation.id);
    return (localId && context.store.find(localId)) || null;
  },
});

builder.queryType({
  fields: (fieldBuilder) => ({
    products: fieldBuilder.connection({
      type: Product,
      description: "All products, Relay-paginated.",
      directives: { rateLimit: { limit: 5, windowSeconds: 10 } },
      resolve: (_root, args, context) => resolveArrayConnection({ args }, context.store.all()),
    }),
  }),
});

export const schema = builder.toSubGraphSchema({
  linkUrl: "https://specs.apollo.dev/federation/v2.9",
  ...rateLimitSchemaOptions,
});
