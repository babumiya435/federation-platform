import { describe, expect, it, vi } from "vitest";
import { entityExists } from "./index.js";

const URL = "http://owner.test/graphql";

function answering(response: Response) {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

describe("entityExists", () => {
  it("is true when the owner returns the entity", async () => {
    const fetchImpl = answering(Response.json({ data: { _entities: [{ __typename: "Product" }] } }));
    expect(await entityExists({ ownerUrl: URL, typeName: "Product", id: "abc", fetchImpl })).toBe(true);
  });

  it("is false when the owner answers null for the id", async () => {
    const fetchImpl = answering(Response.json({ data: { _entities: [null] } }));
    expect(await entityExists({ ownerUrl: URL, typeName: "Product", id: "abc", fetchImpl })).toBe(false);
  });

  it("asks for exactly this entity, with the request id when there is one", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: { _entities: [null] } }));
    await entityExists({ ownerUrl: URL, typeName: "Review", id: "xyz", requestId: "req-1", fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL);
    expect(JSON.parse(init.body as string).variables.representations).toEqual([{ __typename: "Review", id: "xyz" }]);
    expect((init.headers as Record<string, string>)["x-request-id"]).toBe("req-1");
  });

  it("sends no request id header when it has none", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: { _entities: [null] } }));
    await entityExists({ ownerUrl: URL, typeName: "Review", id: "xyz", requestId: null, fetchImpl: fetchImpl as unknown as typeof fetch });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(Object.keys(init.headers as object)).not.toContain("x-request-id");
  });

  it("throws on an HTTP error instead of pretending the entity is missing", async () => {
    const fetchImpl = answering(new Response("boom", { status: 500 }));
    await expect(entityExists({ ownerUrl: URL, typeName: "Product", id: "abc", fetchImpl })).rejects.toThrow(/HTTP 500/);
  });

  it("throws on a GraphQL error", async () => {
    const fetchImpl = answering(Response.json({ errors: [{ message: "owner exploded" }] }));
    await expect(entityExists({ ownerUrl: URL, typeName: "Product", id: "abc", fetchImpl })).rejects.toThrow(/owner exploded/);
  });

  it("throws when the owner cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(entityExists({ ownerUrl: URL, typeName: "Product", id: "abc", fetchImpl })).rejects.toThrow(/fetch failed/);
  });
});
