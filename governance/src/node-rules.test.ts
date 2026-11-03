import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkNodeRules } from "./node-rules.js";
import { formatViolations } from "./report.js";
import { loadSubgraphSdls } from "./repo.js";

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/node/${name}.graphql`, import.meta.url)), "utf8");
const subgraph = (name: string, file: string) => ({ name, sdl: fixture(file) });
const NODE = subgraph("node", "valid-node");

describe("Node rules", () => {
  it("accepts an owner subgraph together with the node subgraph", () => {
    expect(checkNodeRules([subgraph("owner", "valid-owner"), NODE])).toEqual([]);
  });

  it("accepts several owners", () => {
    expect(checkNodeRules([subgraph("one", "valid-owner"), subgraph("two", "valid-owner"), NODE])).toEqual([]);
  });

  it.each([
    ["missing-entity-interface", "node/entity-interface", "does not declare `interface Node @key"],
    ["no-key", "node/resolvable-key", "needs a resolvable `@key"],
    ["unresolvable-key", "node/resolvable-key", "needs a resolvable `@key"],
    ["nullable-id", "node/id-field", "must have a field `id: ID!`"],
    ["reserved-name", "node/reserved-name", "reserved type name"],
    ["interface-extra-field", "node/interface-shape", "exactly `{ id: ID! }`"],
  ])("rejects an owner fixture %s with %s", (file, rule, text) => {
    const violations = checkNodeRules([subgraph("fixture", file), NODE]);
    const match = violations.find((violation) => violation.rule === rule && violation.message.includes(text));
    expect(match, formatViolations(violations)).toBeDefined();
    expect(match?.location).toContain("fixture:");
  });

  it.each([
    ["interface-object-extra-field", "node/interface-object-shape"],
    ["interface-object-no-key", "node/interface-object-shape"],
  ])("rejects a node subgraph fixture %s with %s", (file, rule) => {
    const violations = checkNodeRules([subgraph("owner", "valid-owner"), subgraph("fixture", file)]);
    expect(violations.map((violation) => violation.rule)).toContain(rule);
  });

  it("requires some subgraph to serve Query.node when any subgraph implements Node", () => {
    const violations = checkNodeRules([subgraph("owner", "valid-owner")]);
    expect(violations.map((violation) => violation.rule)).toContain("node/missing-interface-object");
  });

  it("is quiet about a graph with no Node types and no node subgraph", () => {
    expect(checkNodeRules([{ name: "plain", sdl: "type Query { a: Int }" }])).toEqual([]);
  });

  it("is satisfied by the repository as committed", () => {
    const violations = checkNodeRules(loadSubgraphSdls());
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});
