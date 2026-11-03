import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { nodeOwnerUrls, ownerLookup } from "./owners.js";

const GRAPHS = `
enum join__Graph {
  NODE @join__graph(name: "node", url: "http://node:4002/graphql")
  PRODUCT @join__graph(name: "product", url: "http://product:4001/graphql")
  REVIEWS @join__graph(name: "reviews", url: "http://reviews:4004/graphql")
  GADGETS @join__graph(name: "gadgets", url: "http://gadgets:4003/graphql")
}`;

const supergraph = (nodeDirectives: string) => `${GRAPHS}\ninterface Node ${nodeDirectives} { id: ID! }`;

const NODE = '@join__type(graph: NODE, key: "id", isInterfaceObject: true)';
const PRODUCT = '@join__type(graph: PRODUCT, key: "id")';
const REVIEWS = '@join__type(graph: REVIEWS, key: "id")';
const GADGETS = '@join__type(graph: GADGETS, key: "id")';

describe("nodeOwnerUrls", () => {
  it("lists the subgraphs that declare the Node entity interface, sorted", () => {
    expect(nodeOwnerUrls(supergraph(`${REVIEWS} ${NODE} ${PRODUCT}`))).toEqual([
      "http://product:4001/graphql",
      "http://reviews:4004/graphql",
    ]);
  });

  it("leaves out the node subgraph itself (the interface object)", () => {
    expect(nodeOwnerUrls(supergraph(`${NODE} ${PRODUCT}`))).toEqual(["http://product:4001/graphql"]);
  });

  it("picks up a new subgraph as soon as it is composed in, with nothing else changed", () => {
    expect(nodeOwnerUrls(supergraph(`${NODE} ${PRODUCT} ${REVIEWS} ${GADGETS}`))).toContain("http://gadgets:4003/graphql");
  });

  it("returns nothing when no subgraph owns Node, or when a graph has no URL", () => {
    expect(nodeOwnerUrls(`${GRAPHS}\ntype Query { a: Int }`)).toEqual([]);
    expect(nodeOwnerUrls(`enum join__Graph { PRODUCT }\ninterface Node ${PRODUCT} { id: ID! }`)).toEqual([]);
  });

  it("reads the real supergraph in this repository", () => {
    const path = fileURLToPath(new URL("../../../supergraph/supergraph.graphql", import.meta.url));
    expect(nodeOwnerUrls(readFileSync(path, "utf8"))).toEqual([
      "http://product:4001/graphql",
      "http://reviews:4004/graphql",
    ]);
  });
});

describe("ownerLookup", () => {
  const directory = mkdtempSync(`${tmpdir()}/node-owners-`);
  const file = `${directory}/supergraph.graphql`;
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it("follows the file as it changes, without a restart", () => {
    writeFileSync(file, supergraph(`${NODE} ${PRODUCT}`));
    const lookup = ownerLookup(file);
    expect(lookup()).toEqual(["http://product:4001/graphql"]);

    writeFileSync(file, supergraph(`${NODE} ${PRODUCT} ${GADGETS}`));
    expect(lookup()).toEqual(["http://gadgets:4003/graphql", "http://product:4001/graphql"]);
  });

  it("throws when the supergraph cannot be read, so the caller can report it", () => {
    expect(() => ownerLookup(`${directory}/missing.graphql`)()).toThrow();
  });
});
