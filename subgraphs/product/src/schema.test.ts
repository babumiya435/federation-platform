import { createYoga } from "graphql-yoga";
import { describe, expect, it } from "vitest";
import { encodeGlobalId } from "@federation-platform/global-id";
import { CatalogStore } from "./data.js";
import { schema } from "./schema.js";

// Tests go through Yoga's fetch handler so the schema and the executor share one
// copy of `graphql` (importing `execute` here would load a second, ESM copy).
async function run(query: string, variables: Record<string, unknown> = {}) {
  const yoga = createYoga({ schema, context: () => ({ store: new CatalogStore() }) });
  const response = await yoga.fetch("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return (await response.json()) as { data?: any; errors?: unknown[] };
}

describe("product subgraph", () => {
  it("paginates products with a Relay connection", async () => {
    const first = await run(`{ products(first: 2) { edges { cursor node { name } } pageInfo { hasNextPage endCursor } } }`);
    expect(first.errors).toBeUndefined();
    const page = first.data.products;
    expect(page.edges.map((e: any) => e.node.name)).toEqual(["Trail Backpack", "Insulated Bottle"]);
    expect(page.pageInfo.hasNextPage).toBe(true);

    const second = await run(
      `query($after: String) { products(first: 2, after: $after) { edges { node { name } } } }`,
      { after: page.pageInfo.endCursor },
    );
    expect(second.data.products.edges.map((e: any) => e.node.name)).toEqual(["Camp Stove", "Headlamp"]);
  });

  it("resolves Review.product back to the product", async () => {
    const result = await run(`{ products(first: 1) { edges { node { reviews { product { name } } } } } }`);
    const reviews = result.data.products.edges[0].node.reviews;
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews.every((r: any) => r.product.name === "Trail Backpack")).toBe(true);
  });

  it("returns a typed success from addReview", async () => {
    const productId = encodeGlobalId("Product", "p3");
    const result = await run(
      `mutation($input: AddReviewInput!) { addReview(input: $input) { __typename ... on AddReviewSuccess { review { rating product { id } } } } }`,
      { input: { productId, rating: 4, body: "ok", authorEmail: "t@example.com" } },
    );
    expect(result.errors).toBeUndefined();
    expect(result.data.addReview).toEqual({
      __typename: "AddReviewSuccess",
      review: { rating: 4, product: { id: productId } },
    });
  });

  it("returns typed errors for an unknown product and a bad rating", async () => {
    const mutation = `mutation($input: AddReviewInput!) { addReview(input: $input) { __typename ... on UserError { message } } }`;
    const missing = await run(mutation, {
      input: { productId: encodeGlobalId("Product", "nope"), rating: 3, body: "x", authorEmail: "t@example.com" },
    });
    expect(missing.data.addReview.__typename).toBe("ProductNotFoundError");

    const garbled = await run(mutation, {
      input: { productId: "###", rating: 3, body: "x", authorEmail: "t@example.com" },
    });
    expect(garbled.data.addReview.__typename).toBe("ProductNotFoundError");

    const wrongType = await run(mutation, {
      input: { productId: encodeGlobalId("Review", "r1"), rating: 3, body: "x", authorEmail: "t@example.com" },
    });
    expect(wrongType.data.addReview.__typename).toBe("ProductNotFoundError");

    const badRating = await run(mutation, {
      input: { productId: encodeGlobalId("Product", "p1"), rating: 9, body: "x", authorEmail: "t@example.com" },
    });
    expect(badRating.data.addReview.__typename).toBe("InvalidRatingError");
  });

  it("resolves entity references by global id and returns null otherwise", async () => {
    const query = `query($reps: [_Any!]!) { _entities(representations: $reps) { __typename ... on Product { name } ... on Review { rating } } }`;
    const result = await run(query, {
      reps: [
        { __typename: "Product", id: encodeGlobalId("Product", "p2") },
        { __typename: "Review", id: encodeGlobalId("Review", "r1") },
        { __typename: "Product", id: encodeGlobalId("Product", "missing") },
        { __typename: "Product", id: encodeGlobalId("Review", "r1") },
        { __typename: "Product", id: "garbage" },
      ],
    });
    expect(result.errors).toBeUndefined();
    expect(result.data._entities).toEqual([
      { __typename: "Product", name: "Insulated Bottle" },
      { __typename: "Review", rating: 5 },
      null,
      null,
      null,
    ]);
  });
});
