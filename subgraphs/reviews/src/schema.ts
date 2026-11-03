import SchemaBuilder from "@pothos/core";
import DirectivePlugin from "@pothos/plugin-directives";
import FederationPlugin from "@pothos/plugin-federation";
import { localIdFor } from "@federation-platform/global-id";
import { entityExists } from "@federation-platform/owner-check";
import { type RateLimitDirectiveTypes, rateLimitSchemaOptions } from "@federation-platform/rate-limit-directive";
import { GraphQLError } from "graphql";
import { ReviewStore, productId, type ReviewRecord } from "./data.js";

/** Scope vocabulary: see docs/decisions/0003-authorization.md. */
export const SCOPES = {
  reviewsPii: "reviews:read:pii",
} as const;

export interface Context {
  store: ReviewStore;
  /** The product subgraph, asked whether a product exists before a review is added for it. */
  products: { url: string; fetchImpl?: typeof fetch };
  /** Forwarded to the product subgraph so one request id spans the call chain. */
  requestId?: string | null;
}

const builder = new SchemaBuilder<{
  Context: Context;
  FederationScopes: (typeof SCOPES)[keyof typeof SCOPES];
  DefaultFieldNullability: false;
  Directives: RateLimitDirectiveTypes;
}>({
  plugins: [DirectivePlugin, FederationPlugin],
  // Non-null unless a field has a reason to be null (see policy lint).
  defaultFieldNullability: false,
});

/**
 * Node is declared identically in every subgraph that implements it, as an entity interface:
 * the node subgraph hands the router a bare id and each owner says whether the id is one of its
 * entities and which concrete type it is (docs/decisions/0010-node-interface-object.md).
 */
const Node = builder.interfaceRef<{ id: string }>("Node").implement({
  fields: (fieldBuilder) => ({ id: fieldBuilder.id({ resolve: (node) => node.id }) }),
  resolveType: () => Review,
});

const Review = builder.objectRef<ReviewRecord>("Review");

/**
 * Product belongs to the product subgraph. Here it is only a reference (its id) that this
 * subgraph extends with `reviews`; the router fetches everything else from the owner.
 * (docs/decisions/0009-reviews-subgraph.md)
 */
const Product = builder.externalRef("Product", builder.selection<{ id: string }>("id"), (representation) => representation);

Product.implement({
  fields: (fieldBuilder) => ({
    id: fieldBuilder.exposeID("id"),
    reviews: fieldBuilder.field({
      type: [Review],
      directives: { rateLimit: { limit: 20, windowSeconds: 10 } },
      resolve: (product, _args, context) => {
        const productLocalId = localIdFor("Product", product.id);
        return productLocalId ? context.store.forProduct(productLocalId) : [];
      },
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
    // A reference across the subgraph boundary: only the id is known here.
    product: fieldBuilder.field({
      type: Product,
      resolve: (review) => ({ id: productId(review.productLocalId) }),
    }),
  }),
});

/** `id` is the federation key. Unknown or wrong-typed ids resolve to null. */
builder.asEntity(Review, {
  key: builder.selection<{ id: string }>("id"),
  resolveReference: (representation, context) => {
    const localId = localIdFor("Review", representation.id);
    return (localId && context.store.find(localId)) || null;
  },
});

/** The entity interface: a bare Node id resolves to a Review if, and only if, it is one of ours. */
builder.asEntity(Node, {
  key: builder.selection<{ id: string }>("id"),
  resolveReference: (representation, context) => {
    const localId = localIdFor("Review", representation.id);
    return (localId && context.store.find(localId)) || null;
  },
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

/**
 * The product subgraph owns products, so it is the one to ask. If it cannot be reached we say so
 * rather than reporting "no such product", which would be a lie about an outage.
 */
async function productExists(context: Context, id: string): Promise<boolean> {
  try {
    return await entityExists({
      ownerUrl: context.products.url,
      typeName: "Product",
      id,
      requestId: context.requestId,
      fetchImpl: context.products.fetchImpl,
    });
  } catch (error) {
    console.error("product lookup failed:", error);
    throw new GraphQLError("Could not check the product with the product subgraph.", {
      extensions: { code: "PRODUCT_LOOKUP_UNAVAILABLE" },
    });
  }
}

builder.mutationType({
  fields: (fieldBuilder) => ({
    addReview: fieldBuilder.field({
      type: AddReviewResult,
      directives: { rateLimit: { limit: 2, windowSeconds: 10 } },
      args: { input: fieldBuilder.arg({ type: AddReviewInput, required: true }) },
      resolve: async (_root, { input }, context) => {
        if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
          return { message: "Rating must be a whole number from 1 to 5.", rating: input.rating };
        }
        const productLocalId = localIdFor("Product", input.productId);
        if (!productLocalId || !(await productExists(context, input.productId))) {
          return { message: "No product with that id.", productId: input.productId };
        }
        const review = context.store.add({
          productLocalId,
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
  ...rateLimitSchemaOptions,
});
