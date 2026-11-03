import { createYoga } from "graphql-yoga";
import { describe, expect, it } from "vitest";
import { encodeGlobalId } from "@federation-platform/global-id";
import { renderNodeSubgraphSchema } from "./render.js";
import { buildNodeSchema } from "./schema.js";

// Driven through Yoga's fetch so schema and executor share one copy of `graphql`.
async function nodeQuery(sdl: string, id: string) {
  const yoga = createYoga({ schema: buildNodeSchema(sdl) });
  const response = await yoga.fetch("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "query($id: ID!) { node(id: $id) { __typename id } }", variables: { id } }),
  });
  return (await response.json()) as { data?: { node: unknown }; errors?: unknown[] };
}

const sdl = renderNodeSubgraphSchema(["Product", "Review"]);

describe("Query.node", () => {
  it("returns a stub carrying the type name for an eligible type", async () => {
    const id = encodeGlobalId("Product", "trail-backpack");
    expect(await nodeQuery(sdl, id)).toEqual({ data: { node: { __typename: "Product", id } } });
  });

  it("routes by the type name inside the id", async () => {
    const id = encodeGlobalId("Review", "trail-backpack-review-1");
    const result = await nodeQuery(sdl, id);
    expect(result.data?.node).toEqual({ __typename: "Review", id });
  });

  it.each([
    ["malformed", "###"],
    ["empty", ""],
    ["no separator", Buffer.from("Product").toString("base64url")],
    ["unknown type", encodeGlobalId("Gadget", "x")],
    ["reserved type", encodeGlobalId("Query", "x")],
  ])("returns null for a %s id without an error", async (_label, id) => {
    expect(await nodeQuery(sdl, id)).toEqual({ data: { node: null } });
  });

  it("still validates arguments the usual way", async () => {
    const yoga = createYoga({ schema: buildNodeSchema(sdl) });
    const response = await yoga.fetch("http://localhost/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ node { id } }" }),
    });
    const body = (await response.json()) as { errors?: unknown[] };
    expect(body.errors?.length).toBeGreaterThan(0);
  });
});
