import { describe, expect, it } from "vitest";
import { composeSupergraph } from "./composition.js";

const base = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])
  type Query { thing: Thing }
  type Thing @key(fields: "id") { id: ID! }
`;

describe("composeSupergraph", () => {
  it("composes compatible subgraphs and keeps their join info", () => {
    const result = composeSupergraph([
      { name: "things", url: "http://things:1/graphql", sdl: base },
      {
        name: "extras",
        url: "http://extras:2/graphql",
        sdl: `
          extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])
          type Thing @key(fields: "id") { id: ID! extra: String }
        `,
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.supergraphSdl).toContain('url: "http://things:1/graphql"');
      expect(result.supergraphSdl).toContain("extra: String");
    }
  });

  it("reports conflicting definitions as readable errors with codes", () => {
    const result = composeSupergraph([
      { name: "things", url: "http://things:1/graphql", sdl: base },
      {
        name: "clash",
        url: "http://clash:2/graphql",
        sdl: `
          extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key", "@shareable"])
          type Query { other: Int }
          type Thing @key(fields: "id") { id: String! }
          type Other @shareable { size: Int }
        `,
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join("\n")).toMatch(/Thing\.id|id/);
    }
  });
});
