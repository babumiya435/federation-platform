import { createYoga } from "graphql-yoga";
import { describe, expect, it, vi } from "vitest";
import { encodeGlobalId } from "@federation-platform/global-id";
import { ReviewStore } from "./data.js";
import { type Context, schema } from "./schema.js";

const PRODUCTS_URL = "http://product.test/graphql";
const productId = (localId: string) => encodeGlobalId("Product", localId);

/** A fake product subgraph: says which product ids exist. */
function fakeProductSubgraph(existing: string[]) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { variables: { representations: { id: string }[] } };
    const known = existing.includes(body.variables.representations[0]?.id ?? "");
    return Response.json({ data: { _entities: [known ? { __typename: "Product" } : null] } });
  });
}

// Driven through Yoga's fetch so the schema and the executor share one copy of `graphql`.
async function run(query: string, options: { variables?: Record<string, unknown>; fetchImpl?: typeof fetch; requestId?: string } = {}) {
  const yoga = createYoga<object, Context>({
    schema,
    context: () => ({
      store: new ReviewStore(),
      products: { url: PRODUCTS_URL, fetchImpl: options.fetchImpl },
      requestId: options.requestId,
    }),
  });
  const response = await yoga.fetch("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: options.variables ?? {} }),
  });
  return (await response.json()) as { data?: any; errors?: { message: string; extensions?: { code?: string } }[] };
}

const ADD_REVIEW = `mutation($input: AddReviewInput!) { addReview(input: $input) { __typename ... on UserError { message } ... on AddReviewSuccess { review { id rating product { id } } } } }`;
const input = (overrides: Record<string, unknown> = {}) => ({
  productId: productId("camp-stove"),
  rating: 4,
  body: "ok",
  authorEmail: "t@example.com",
  ...overrides,
});

describe("what this subgraph owns", () => {
  it("owns Review, and only extends Product with its id and reviews", async () => {
    const result = await run(`{ __type(name: "Product") { fields { name } } }`);
    expect(result.data.__type.fields.map((field: { name: string }) => field.name).sort()).toEqual(["id", "reviews"]);
  });

  it("resolves a Review by its global id, and returns null otherwise", async () => {
    const result = await run(
      `query($reps: [_Any!]!) { _entities(representations: $reps) { __typename ... on Review { rating } } }`,
      {
        variables: {
          reps: [
            { __typename: "Review", id: encodeGlobalId("Review", "trail-backpack-review-1") },
            { __typename: "Review", id: encodeGlobalId("Review", "missing") },
            { __typename: "Review", id: productId("trail-backpack") },
            { __typename: "Review", id: "garbage" },
          ],
        },
      },
    );
    expect(result.errors).toBeUndefined();
    expect(result.data._entities).toEqual([{ __typename: "Review", rating: 5 }, null, null, null]);
  });
});

describe("the Node entity interface", () => {
  it("resolves a bare Node id to a concrete Review only if it is one of ours", async () => {
    const query = `query($reps: [_Any!]!) { _entities(representations: $reps) { __typename ... on Review { rating } } }`;
    const result = await run(query, {
      variables: {
        reps: [
          { __typename: "Node", id: encodeGlobalId("Review", "insulated-bottle-review-1") },
          { __typename: "Node", id: encodeGlobalId("Review", "missing") },
          { __typename: "Node", id: productId("trail-backpack") },
          { __typename: "Node", id: "garbage" },
        ],
      },
    });
    expect(result.errors).toBeUndefined();
    expect(result.data._entities).toEqual([{ __typename: "Review", rating: 4 }, null, null, null]);
  });
});

describe("references across the subgraph boundary", () => {
  it("Review.product is a reference: just the product's id, for the router to fill in", async () => {
    const result = await run(
      `query($reps: [_Any!]!) { _entities(representations: $reps) { ... on Review { product { id } } } }`,
      { variables: { reps: [{ __typename: "Review", id: encodeGlobalId("Review", "insulated-bottle-review-1") }] } },
    );
    expect(result.data._entities[0].product.id).toBe(productId("insulated-bottle"));
  });

  it("adds Product.reviews to a product it only knows by id", async () => {
    const query = `query($reps: [_Any!]!) { _entities(representations: $reps) { ... on Product { reviews { id rating } } } }`;
    const result = await run(query, {
      variables: {
        reps: [
          { __typename: "Product", id: productId("trail-backpack") },
          { __typename: "Product", id: productId("headlamp") },
          { __typename: "Product", id: encodeGlobalId("Review", "trail-backpack-review-1") },
        ],
      },
    });
    expect(result.errors).toBeUndefined();
    expect(result.data._entities[0].reviews.map((review: { rating: number }) => review.rating)).toEqual([5, 3]);
    expect(result.data._entities[1].reviews).toEqual([]);
    expect(result.data._entities[2].reviews).toEqual([]);
  });
});

describe("addReview", () => {
  it("adds a review when the product subgraph says the product exists, and asks it the right question", async () => {
    const fetchImpl = fakeProductSubgraph([productId("camp-stove")]);
    const result = await run(ADD_REVIEW, { variables: { input: input() }, fetchImpl: fetchImpl as unknown as typeof fetch, requestId: "req-7" });

    expect(result.data.addReview).toEqual({
      __typename: "AddReviewSuccess",
      review: { id: encodeGlobalId("Review", "camp-stove-review-1"), rating: 4, product: { id: productId("camp-stove") } },
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(PRODUCTS_URL);
    expect(JSON.parse(init.body as string).variables.representations).toEqual([{ __typename: "Product", id: productId("camp-stove") }]);
    expect((init.headers as Record<string, string>)["x-request-id"]).toBe("req-7");
  });

  it("returns ProductNotFoundError when the product subgraph does not know the product", async () => {
    const fetchImpl = fakeProductSubgraph([]);
    const result = await run(ADD_REVIEW, { variables: { input: input({ productId: productId("nope") }) }, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.data.addReview.__typename).toBe("ProductNotFoundError");
  });

  it.each([
    ["a rating of 9", { rating: 9 }],
    ["a rating of 0", { rating: 0 }],
  ])("returns InvalidRatingError for %s without asking the product subgraph", async (_label, overrides) => {
    const fetchImpl = fakeProductSubgraph([productId("camp-stove")]);
    const result = await run(ADD_REVIEW, { variables: { input: input(overrides) }, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.data.addReview.__typename).toBe("InvalidRatingError");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed id", "###"],
    ["the id of something that is not a product", encodeGlobalId("Review", "trail-backpack-review-1")],
  ])("returns ProductNotFoundError for %s without asking the product subgraph", async (_label, badId) => {
    const fetchImpl = fakeProductSubgraph([]);
    const result = await run(ADD_REVIEW, { variables: { input: input({ productId: badId }) }, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.data.addReview.__typename).toBe("ProductNotFoundError");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an unreachable product subgraph as an error, not as 'no such product'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const result = await run(ADD_REVIEW, { variables: { input: input() }, fetchImpl });
    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("PRODUCT_LOOKUP_UNAVAILABLE");
    expect(result.errors?.[0]?.message).not.toContain("fetch failed"); // internals stay in the server log
  });
});
