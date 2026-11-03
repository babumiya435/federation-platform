import { createYoga } from "graphql-yoga";
import { describe, expect, it } from "vitest";
import { encodeGlobalId } from "@federation-platform/global-id";
import { ProductStore } from "./data.js";
import { schema } from "./schema.js";

// Tests go through Yoga's fetch handler so the schema and the executor share one
// copy of `graphql` (importing `execute` here would load a second, ESM copy).
async function run(query: string, variables: Record<string, unknown> = {}) {
  const yoga = createYoga({ schema, context: () => ({ store: new ProductStore() }) });
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
    expect(page.edges.map((edge: any) => edge.node.name)).toEqual(["Trail Backpack", "Insulated Bottle"]);
    expect(page.pageInfo.hasNextPage).toBe(true);

    const second = await run(
      `query($after: String) { products(first: 2, after: $after) { edges { node { name } } } }`,
      { after: page.pageInfo.endCursor },
    );
    expect(second.data.products.edges.map((edge: any) => edge.node.name)).toEqual(["Camp Stove", "Headlamp"]);
  });

  it("owns Product only: reviews and the mutation live in the reviews subgraph", async () => {
    const result = await run(`{ __schema { types { name } mutationType { name } } }`);
    const names = result.data.__schema.types.map((type: any) => type.name);
    expect(names).toContain("Product");
    expect(names).not.toContain("Review");
    expect(result.data.__schema.mutationType).toBeNull();
  });

  it("resolves a Product by its global id, and returns null otherwise", async () => {
    const query = `query($reps: [_Any!]!) { _entities(representations: $reps) { __typename ... on Product { name internalCost } } }`;
    const result = await run(query, {
      reps: [
        { __typename: "Product", id: encodeGlobalId("Product", "insulated-bottle") },
        { __typename: "Product", id: encodeGlobalId("Product", "missing") },
        { __typename: "Product", id: encodeGlobalId("Review", "trail-backpack-review-1") },
        { __typename: "Product", id: "garbage" },
      ],
    });
    // internalCost is protected at the router; at the subgraph the field is readable.
    expect(result.errors).toBeUndefined();
    expect(result.data._entities).toEqual([{ __typename: "Product", name: "Insulated Bottle", internalCost: 9.2 }, null, null, null]);
  });

  it("resolves a bare Node id to a concrete Product only if it is one of ours", async () => {
    const query = `query($reps: [_Any!]!) { _entities(representations: $reps) { __typename ... on Product { name } } }`;
    const result = await run(query, {
      reps: [
        { __typename: "Node", id: encodeGlobalId("Product", "headlamp") },
        { __typename: "Node", id: encodeGlobalId("Product", "missing") },
        { __typename: "Node", id: encodeGlobalId("Review", "trail-backpack-review-1") },
        { __typename: "Node", id: "garbage" },
      ],
    });
    expect(result.errors).toBeUndefined();
    expect(result.data._entities).toEqual([{ __typename: "Product", name: "Headlamp" }, null, null, null]);
  });
});
