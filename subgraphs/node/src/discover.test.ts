import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverNodeTypes, type SubgraphSource } from "./discover.js";
import { renderNodeSubgraphSchema } from "./render.js";

const fixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));
const subgraphsDir = fileURLToPath(new URL("../../", import.meta.url));

function loadFixture(caseName: string): SubgraphSource[] {
  const directory = `${fixturesDir}${caseName}/`;
  return readdirSync(directory)
    .filter((file) => file.endsWith(".graphql"))
    .map((file) => ({
      name: file.replace(/\.graphql$/, ""),
      sdl: readFileSync(`${directory}${file}`, "utf8"),
    }));
}

describe("discoverNodeTypes", () => {
  it("accepts a valid graph and lists every eligible type once", () => {
    const result = discoverNodeTypes(loadFixture("valid"));
    expect(result.violations).toEqual([]);
    expect(result.typeNames).toEqual(["Gadget", "Widget"]);
    // Widget is contributed to by two subgraphs, so both can answer for it.
    expect(result.owners).toEqual({ Gadget: ["gadgets"], Widget: ["gadgets", "products"] });
  });

  it("does not count a subgraph that only adds fields to a type as its owner", () => {
    const result = discoverNodeTypes(loadFixture("valid-contributor"));
    expect(result.violations).toEqual([]);
    // reviews can resolve any Widget id, but only products implements Node and owns Widget.
    expect(result.owners).toEqual({ Widget: ["products"] });
  });

  it("finds Product and Review in the real subgraphs", () => {
    const sources = readdirSync(subgraphsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "node")
      .map((entry) => ({
        name: entry.name,
        sdl: readFileSync(`${subgraphsDir}${entry.name}/schema.graphql`, "utf8"),
      }));
    const result = discoverNodeTypes(sources);
    expect(result.violations).toEqual([]);
    expect(result.typeNames).toEqual(expect.arrayContaining(["Product", "Review"]));
    // Review lives in its own subgraph; reviews only adds fields to Product, so it does not own it.
    expect(result.owners).toMatchObject({ Product: ["product"], Review: ["reviews"] });
  });

  it.each([
    ["n1-nullable-id", "N1", "Gadget"],
    ["n2-missing-key", "N2", "Gadget"],
    ["n2-key-not-id", "N2", "Gadget"],
    ["n2-only-unresolvable", "N2", "Gadget"],
    ["n2-key-only-in-contributor", "N2", "Gadget"],
    ["n3-reserved-name", "N3", "Mutation"],
    ["n4-extra-interface-field", "N4", "Node"],
  ])("rejects fixture %s with rule %s", (caseName, rule, typeName) => {
    const { violations } = discoverNodeTypes(loadFixture(caseName));
    expect(violations.map((violation) => [violation.rule, violation.typeName])).toContainEqual([
      rule,
      typeName,
    ]);
  });

  it("names the type, the subgraph and the fix in the message", () => {
    const [violation] = discoverNodeTypes(loadFixture("n2-missing-key")).violations;
    expect(violation?.message).toContain('"Gadget"');
    expect(violation?.message).toContain('"gadgets"');
    expect(violation?.message).toContain('@key(fields: "id")');
  });
});

describe("renderNodeSubgraphSchema", () => {
  it("declares each type as a non-resolvable stub and is deterministic", () => {
    const first = renderNodeSubgraphSchema(["Gadget", "Widget"]);
    expect(first).toContain('type Gadget implements Node @key(fields: "id", resolvable: false)');
    expect(first).toContain("node(id: ID!): Node");
    expect(renderNodeSubgraphSchema(["Gadget", "Widget"])).toBe(first);
  });
});
