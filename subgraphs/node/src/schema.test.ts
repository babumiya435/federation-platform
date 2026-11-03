import { createYoga } from "graphql-yoga";
import { describe, expect, it, vi } from "vitest";
import { encodeGlobalId } from "@federation-platform/global-id";
import { renderNodeSubgraphSchema } from "./render.js";
import { buildNodeSchema, type NodeContext, type OwnerMap } from "./schema.js";

const sdl = renderNodeSubgraphSchema(["Product", "Review"]);
const owners: OwnerMap = {
  Product: ["http://product.test/graphql"],
  Review: ["http://product.test/graphql", "http://reviews.test/graphql"],
};

/** A fake owner: answers `_entities` with the entity (or null) per URL. */
function fakeOwners(existsByUrl: Record<string, boolean | "http-error" | "graphql-error">) {
  return vi.fn(async (url: string | URL | Request) => {
    const behaviour = existsByUrl[String(url)];
    if (behaviour === "http-error") {
      return new Response("boom", { status: 500 });
    }
    if (behaviour === "graphql-error") {
      return Response.json({ errors: [{ message: "owner exploded" }] });
    }
    return Response.json({ data: { _entities: [behaviour ? { __typename: "X" } : null] } });
  });
}

// Driven through Yoga's fetch so schema and executor share one copy of `graphql`.
async function nodeQuery(id: string, fetchImpl: typeof fetch, requestId?: string) {
  const yoga = createYoga<object, NodeContext>({
    schema: buildNodeSchema({ sdl, owners, fetchImpl }),
    context: ({ request }) => ({ requestId: request.headers.get("x-request-id") }),
  });
  const response = await yoga.fetch("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", ...(requestId ? { "x-request-id": requestId } : {}) },
    body: JSON.stringify({ query: "query($id: ID!) { node(id: $id) { __typename id } }", variables: { id } }),
  });
  return (await response.json()) as { data?: { node: unknown }; errors?: { message: string }[] };
}

describe("Query.node", () => {
  it("returns a stub when the owner has the entity, and asks the owner with the right key", async () => {
    const id = encodeGlobalId("Product", "trail-backpack");
    const fetchImpl = fakeOwners({ "http://product.test/graphql": true });

    expect(await nodeQuery(id, fetchImpl as unknown as typeof fetch)).toEqual({
      data: { node: { __typename: "Product", id } },
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://product.test/graphql");
    expect(JSON.parse(init.body as string).variables.representations).toEqual([
      { __typename: "Product", id },
    ]);
  });

  it("returns null when the owner does not know a well-formed id", async () => {
    const id = encodeGlobalId("Product", "no-such-product");
    const fetchImpl = fakeOwners({ "http://product.test/graphql": false });
    expect(await nodeQuery(id, fetchImpl as unknown as typeof fetch)).toEqual({ data: { node: null } });
  });

  it("counts an entity as found when any one of several owners has it", async () => {
    const id = encodeGlobalId("Review", "trail-backpack-review-1");
    const fetchImpl = fakeOwners({
      "http://product.test/graphql": false,
      "http://reviews.test/graphql": true,
    });
    const result = await nodeQuery(id, fetchImpl as unknown as typeof fetch);
    expect(result.data?.node).toEqual({ __typename: "Review", id });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["malformed", "###"],
    ["empty", ""],
    ["no separator", Buffer.from("Product").toString("base64url")],
    ["unknown type", encodeGlobalId("Gadget", "x")],
    ["reserved type", encodeGlobalId("Query", "x")],
  ])("returns null for a %s id without calling any owner", async (_label, id) => {
    const fetchImpl = fakeOwners({});
    expect(await nodeQuery(id, fetchImpl as unknown as typeof fetch)).toEqual({ data: { node: null } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("forwards the request id to the owner", async () => {
    const fetchImpl = fakeOwners({ "http://product.test/graphql": true });
    await nodeQuery(encodeGlobalId("Product", "p"), fetchImpl as unknown as typeof fetch, "req-123");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-request-id"]).toBe("req-123");
  });

  it.each([
    ["an HTTP error", "http-error"],
    ["a GraphQL error", "graphql-error"],
  ] as const)("reports %s from an owner instead of pretending the id is unknown", async (_label, behaviour) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = encodeGlobalId("Product", "trail-backpack");
    const fetchImpl = fakeOwners({ "http://product.test/graphql": behaviour });
    const result = await nodeQuery(id, fetchImpl as unknown as typeof fetch);
    expect(result.data?.node).toBeNull();
    expect(result.errors?.[0]?.message).toContain("owning subgraph");
    expect(result.errors?.[0]?.message).not.toContain("exploded"); // internals stay server-side
  });

  it("still validates arguments the usual way", async () => {
    const yoga = createYoga({ schema: buildNodeSchema({ sdl, owners, fetchImpl: fakeOwners({}) as unknown as typeof fetch }) });
    const response = await yoga.fetch("http://localhost/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ node { id } }" }),
    });
    const body = (await response.json()) as { errors?: unknown[] };
    expect(body.errors?.length).toBeGreaterThan(0);
  });
});
