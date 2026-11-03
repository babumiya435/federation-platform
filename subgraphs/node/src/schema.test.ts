import { createYoga } from "graphql-yoga";
import { describe, expect, it, vi } from "vitest";
import { encodeGlobalId } from "@federation-platform/global-id";
import { buildNodeSchema, type NodeContext } from "./schema.js";

const OWNERS = ["http://product.test/graphql", "http://reviews.test/graphql"];

/** Fake owners: each answers the Node entity question with an entity or null, per URL. */
function fakeOwners(owns: Record<string, boolean | "http-error" | "graphql-error">) {
  return vi.fn(async (url: string | URL | Request) => {
    const behaviour = owns[String(url)];
    if (behaviour === "http-error") return new Response("boom", { status: 500 });
    if (behaviour === "graphql-error") return Response.json({ errors: [{ message: "owner exploded" }] });
    return Response.json({ data: { _entities: [behaviour ? { __typename: "Product" } : null] } });
  });
}

// Driven through Yoga's fetch so the schema and the executor share one copy of `graphql`.
async function run(
  query: string,
  options: { fetchImpl?: typeof fetch; ownerUrls?: () => string[]; requestId?: string; variables?: Record<string, unknown> } = {},
) {
  const yoga = createYoga<object, NodeContext>({
    schema: buildNodeSchema({ ownerUrls: options.ownerUrls ?? (() => OWNERS), fetchImpl: options.fetchImpl }),
    context: ({ request }) => ({ requestId: request.headers.get("x-request-id") }),
  });
  const response = await yoga.fetch("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", ...(options.requestId ? { "x-request-id": options.requestId } : {}) },
    body: JSON.stringify({ query, variables: options.variables ?? {} }),
  });
  return (await response.json()) as { data?: any; errors?: { message: string; extensions?: { code?: string } }[] };
}

const NODE_QUERY = "query($id: ID!) { node(id: $id) { id } }";
const node = (id: string, options: Parameters<typeof run>[1] = {}) => run(NODE_QUERY, { ...options, variables: { id } });
const asFetch = (mock: ReturnType<typeof fakeOwners>) => mock as unknown as typeof fetch;

describe("Query.node", () => {
  it("returns a bare id when an owner has the entity, and asks every owner about this id", async () => {
    const id = encodeGlobalId("Product", "trail-backpack");
    const fetchImpl = fakeOwners({ [OWNERS[0]!]: true, [OWNERS[1]!]: false });

    expect(await node(id, { fetchImpl: asFetch(fetchImpl) })).toEqual({ data: { node: { id } } });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect(JSON.parse(call[1].body as string).variables.representations).toEqual([{ __typename: "Node", id }]);
    }
    expect((fetchImpl.mock.calls as unknown as [string][]).map((call) => call[0]).sort()).toEqual([...OWNERS].sort());
  });

  it("returns null when no owner has the entity", async () => {
    const id = encodeGlobalId("Product", "no-such-product");
    const fetchImpl = fakeOwners({ [OWNERS[0]!]: false, [OWNERS[1]!]: false });
    expect(await node(id, { fetchImpl: asFetch(fetchImpl) })).toEqual({ data: { node: null } });
  });

  it("counts an entity as found when any one owner has it", async () => {
    const id = encodeGlobalId("Review", "trail-backpack-review-1");
    const fetchImpl = fakeOwners({ [OWNERS[0]!]: false, [OWNERS[1]!]: true });
    expect((await node(id, { fetchImpl: asFetch(fetchImpl) })).data.node).toEqual({ id });
  });

  it("returns null for an id naming a type nobody has, because no owner answers for it", async () => {
    const id = encodeGlobalId("Gadget", "sprocket");
    const fetchImpl = fakeOwners({ [OWNERS[0]!]: false, [OWNERS[1]!]: false });
    expect(await node(id, { fetchImpl: asFetch(fetchImpl) })).toEqual({ data: { node: null } });
  });

  it.each([
    ["malformed", "###"],
    ["empty", ""],
    ["no separator", Buffer.from("Product").toString("base64url")],
  ])("returns null for a %s id without calling any owner", async (_label, id) => {
    const fetchImpl = fakeOwners({});
    expect(await node(id, { fetchImpl: asFetch(fetchImpl) })).toEqual({ data: { node: null } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when no subgraph owns Node at all", async () => {
    const fetchImpl = fakeOwners({});
    const result = await node(encodeGlobalId("Product", "x"), { fetchImpl: asFetch(fetchImpl), ownerUrls: () => [] });
    expect(result).toEqual({ data: { node: null } });
  });

  it("asks the owners the supergraph lists at the time of the request", async () => {
    const id = encodeGlobalId("Gadget", "sprocket");
    let owners = [OWNERS[0]!];
    const fetchImpl = fakeOwners({ [OWNERS[0]!]: false, "http://gadgets.test/graphql": true });
    const ownerUrls = () => owners;

    expect((await node(id, { fetchImpl: asFetch(fetchImpl), ownerUrls })).data.node).toBeNull();
    owners = [OWNERS[0]!, "http://gadgets.test/graphql"]; // a new subgraph was composed in
    expect((await node(id, { fetchImpl: asFetch(fetchImpl), ownerUrls })).data.node).toEqual({ id });
  });

  it("forwards the request id to the owners", async () => {
    const fetchImpl = fakeOwners({ [OWNERS[0]!]: true, [OWNERS[1]!]: false });
    await node(encodeGlobalId("Product", "p"), { fetchImpl: asFetch(fetchImpl), requestId: "req-123" });
    for (const call of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect((call[1].headers as Record<string, string>)["x-request-id"]).toBe("req-123");
    }
  });

  it.each([
    ["an HTTP error", "http-error"],
    ["a GraphQL error", "graphql-error"],
  ] as const)("reports %s from an owner instead of pretending the id is unknown", async (_label, behaviour) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = fakeOwners({ [OWNERS[0]!]: behaviour, [OWNERS[1]!]: false });
    const result = await node(encodeGlobalId("Product", "trail-backpack"), { fetchImpl: asFetch(fetchImpl) });
    expect(result.data.node).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe("NODE_OWNER_UNAVAILABLE");
    expect(result.errors?.[0]?.message).not.toContain("exploded"); // internals stay server-side
  });

  it("reports an unreadable supergraph the same way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await node(encodeGlobalId("Product", "x"), {
      ownerUrls: () => {
        throw new Error("ENOENT");
      },
    });
    expect(result.errors?.[0]?.extensions?.code).toBe("NODE_OWNER_UNAVAILABLE");
  });

  it("still validates arguments the usual way", async () => {
    expect((await run("{ node { id } }")).errors?.length).toBeGreaterThan(0);
  });
});

describe("Node as an entity", () => {
  it("resolves a Node reference to its id, which is all this subgraph knows", async () => {
    const id = encodeGlobalId("Product", "x");
    const result = await run("query($reps: [_Any!]!) { _entities(representations: $reps) { ... on Node { id } } }", {
      variables: { reps: [{ __typename: "Node", id }] },
    });
    expect(result.errors).toBeUndefined();
    expect(result.data._entities).toEqual([{ id }]);
  });
});
