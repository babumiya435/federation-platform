import SchemaBuilder from "@pothos/core";
import DirectivePlugin from "@pothos/plugin-directives";
import FederationPlugin from "@pothos/plugin-federation";
import RelayPlugin, { resolveArrayConnection } from "@pothos/plugin-relay";
import { decodeGlobalId } from "@federation-platform/global-id";
import { CatalogStore, type ProductRecord, type ReviewRecord } from "./data.js";

/** Scope vocabulary: see docs/decisions/0003-authorization.md. */
export const SCOPES = {
  catalogInternal: "catalog:read:internal",
  reviewsPii: "reviews:read:pii",
} as const;

export interface Context {
  store: CatalogStore;
}

const builder = new SchemaBuilder<{
  Context: Context;
  FederationScopes: (typeof SCOPES)[keyof typeof SCOPES];
  DefaultFieldNullability: false;
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

/** Node is declared identically in every subgraph that implements it. */
const Node = builder.interfaceRef<{ id: string }>("Node").implement({
  fields: (fieldBuilder) => ({ id: fieldBuilder.id({ resolve: (node) => node.id }) }),
});

const Product = builder.objectRef<ProductRecord>("Product");
const Review = builder.objectRef<ReviewRecord>("Review");

Product.implement({
  interfaces: [Node],
  fields: (fieldBuilder) => ({
    id: fieldBuilder.exposeID("id"),
    name: fieldBuilder.exposeString("name"),
    price: fieldBuilder.exposeFloat("price"),
    internalCost: fieldBuilder.exposeFloat("internalCost", {
      requiresScopes: [[SCOPES.catalogInternal]],
    }),
    reviews: fieldBuilder.field({
      type: [Review],
      resolve: (product, _args, context) => context.store.reviewsFor(product.localId),
    }),
  }),
});

Review.implement({
  interfaces: [Node],
  fields: (fieldBuilder) => ({
    id: fieldBuilder.exposeID("id"),
    rating: fieldBuilder.exposeInt("rating"),
    body: fieldBuilder.exposeString("body"),
    authorEmail: fieldBuilder.exposeString("authorEmail", {
      requiresScopes: [[SCOPES.reviewsPii]],
    }),
    product: fieldBuilder.field({
      type: Product,
      resolve: (review, _args, context) => {
        const product = context.store.product(review.productLocalId);
        if (!product) {
          throw new Error(`Review ${review.localId} points at a missing product`);
        }
        return product;
      },
    }),
  }),
});

/** `id` is the federation key. Unknown or wrong-typed ids resolve to null. */
function localIdFor(typeName: string, id: string): string | null {
  const decoded = decodeGlobalId(id);
  return decoded && decoded.typeName === typeName ? decoded.localId : null;
}

builder.asEntity(Product, {
  key: builder.selection<{ id: string }>("id"),
  resolveReference: (representation, context) => {
    const localId = localIdFor("Product", representation.id);
    return (localId && context.store.product(localId)) || null;
  },
});

builder.asEntity(Review, {
  key: builder.selection<{ id: string }>("id"),
  resolveReference: (representation, context) => {
    const localId = localIdFor("Review", representation.id);
    return (localId && context.store.review(localId)) || null;
  },
});

builder.queryType({
  fields: (fieldBuilder) => ({
    products: fieldBuilder.connection({
      type: Product,
      description: "All products, Relay-paginated.",
      resolve: (_root, args, context) => resolveArrayConnection({ args }, context.store.allProducts()),
    }),
  }),
});

// ---- Mutation with a result union (success + typed errors) ----

const UserError = builder.interfaceRef<{ message: string }>("UserError").implement({
  fields: (fieldBuilder) => ({ message: fieldBuilder.exposeString("message") }),
});

const AddReviewSuccess = builder
  .objectRef<{ review: ReviewRecord }>("AddReviewSuccess")
  .implement({ fields: (fieldBuilder) => ({ review: fieldBuilder.field({ type: Review, resolve: (success) => success.review }) }) });

const ProductNotFoundError = builder
  .objectRef<{ message: string; productId: string }>("ProductNotFoundError")
  .implement({
    interfaces: [UserError],
    fields: (fieldBuilder) => ({ productId: fieldBuilder.exposeID("productId") }),
  });

const InvalidRatingError = builder
  .objectRef<{ message: string; rating: number }>("InvalidRatingError")
  .implement({
    interfaces: [UserError],
    fields: (fieldBuilder) => ({ rating: fieldBuilder.exposeInt("rating") }),
  });

const AddReviewResult = builder.unionType("AddReviewResult", {
  types: [AddReviewSuccess, ProductNotFoundError, InvalidRatingError],
  resolveType: (value) => {
    if ("review" in value) return AddReviewSuccess;
    if ("productId" in value) return ProductNotFoundError;
    return InvalidRatingError;
  },
});

const AddReviewInput = builder.inputType("AddReviewInput", {
  fields: (fieldBuilder) => ({
    productId: fieldBuilder.id({ required: true }),
    rating: fieldBuilder.int({ required: true }),
    body: fieldBuilder.string({ required: true }),
    authorEmail: fieldBuilder.string({ required: true }),
  }),
});

builder.mutationType({
  fields: (fieldBuilder) => ({
    addReview: fieldBuilder.field({
      type: AddReviewResult,
      args: { input: fieldBuilder.arg({ type: AddReviewInput, required: true }) },
      resolve: (_root, { input }, context) => {
        if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
          return { message: "Rating must be a whole number from 1 to 5.", rating: input.rating };
        }
        const localId = localIdFor("Product", input.productId);
        const product = localId ? context.store.product(localId) : undefined;
        if (!product) {
          return { message: "No product with that id.", productId: input.productId };
        }
        const review = context.store.addReview({
          productLocalId: product.localId,
          rating: input.rating,
          body: input.body,
          authorEmail: input.authorEmail,
        });
        return { review };
      },
    }),
  }),
});

export const schema = builder.toSubGraphSchema({
  linkUrl: "https://specs.apollo.dev/federation/v2.9",
});
