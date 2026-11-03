import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildASTSchema, parse } from "graphql";
import { describe, expect, it } from "vitest";
import { apiSchemaFromSupergraph } from "./api-schema.js";
import { checkDecisions } from "./decisions.js";
import { validateOperations } from "./operations.js";
import { checkPolicy } from "./policy.js";
import { formatViolations } from "./report.js";
import { loadOperationFiles, loadSubgraphSdls, readRepoFile } from "./repo.js";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
const fixture = (path: string) => readFileSync(`${fixtures}${path}`, "utf8");
const schemaFrom = (sdl: string) => buildASTSchema(parse(sdl));

const vocabulary = Object.keys(JSON.parse(readRepoFile("governance/scopes.json")) as Record<string, string>);
const decisionsFor = (file: string) => checkDecisions([{ name: "fixture", sdl: fixture(`decisions/${file}`) }], vocabulary);

describe("policy lint", () => {
  it("accepts a schema that follows the policy", () => {
    expect(checkPolicy(schemaFrom(fixture("policy/valid.graphql")))).toEqual([]);
  });

  it.each([
    ["mutation-returns-object.graphql", "policy/mutation-result-union", "Mutation.addProduct", "not a union"],
    ["mutation-union-without-errors.graphql", "policy/mutation-result-union", "Mutation.addProduct", "at least one type named `...Error`"],
    ["connection-without-pagination-args.graphql", "policy/relay-connection-shape", "Query.products", "no pagination arguments"],
    ["connection-without-page-info.graphql", "policy/relay-connection-shape", "Query.products", "pageInfo must be `PageInfo!`"],
    ["bad-names.graphql", "policy/naming-convention", "Query.Products", "camelCase"],
    ["bad-names.graphql", "policy/naming-convention", "product_item", "PascalCase"],
    ["bad-names.graphql", "policy/naming-convention", "currency.usd", "SCREAMING_SNAKE_CASE"],
    ["bad-names.graphql", "policy/naming-convention", "make_thing", "...Input"],
  ])("rejects %s with %s at %s", (file, rule, location, text) => {
    const violations = checkPolicy(schemaFrom(fixture(`policy/${file}`)));
    const match = violations.find(
      (violation) =>
        violation.rule === rule && violation.location === location && violation.message.includes(text),
    );
    expect(match, formatViolations(violations)).toBeDefined();
  });
});

describe("decision checks", () => {
  it("accepts schemas that follow the decisions", () => {
    expect(decisionsFor("valid.graphql")).toEqual([]);
  });

  it.each([
    ["requires-scopes-on-interface.graphql", "decisions/requires-scopes-placement", "interface fields"],
    ["requires-scopes-on-type.graphql", "decisions/requires-scopes-placement", "not on the type itself"],
    ["requires-scopes-on-query-node.graphql", "decisions/requires-scopes-placement", "Query.node"],
    ["unknown-scope.graphql", "decisions/scope-vocabulary", "not in governance/scopes.json"],
    ["malformed-scope.graphql", "decisions/scope-vocabulary", "<domain>:<action>:<sensitivity>"],
    ["or-groups.graphql", "decisions/requires-scopes-single-list", "2 scope lists"],
    ["rate-limit-on-interface.graphql", "decisions/rate-limit-placement", "interface fields"],
    ["rate-limit-implements-interface-field.graphql", "decisions/rate-limit-placement", "through the interface"],
    ["rate-limit-bad-arguments.graphql", "decisions/rate-limit-arguments", "`limit` must be an integer >= 1"],
    ["rate-limit-bad-arguments.graphql", "decisions/rate-limit-arguments", "`windowSeconds` must be an integer"],
    ["rate-limit-bad-arguments.graphql", "decisions/rate-limit-arguments", "could never be called"],
    ["rate-limit-bad-arguments.graphql", "decisions/rate-limit-arguments", 'unknown argument "burst"'],
  ])("rejects %s with %s", (file, rule, text) => {
    const violations = decisionsFor(file);
    const match = violations.find((violation) => violation.rule === rule && violation.message.includes(text));
    expect(match, formatViolations(violations)).toBeDefined();
  });

  it("names the subgraph and the field", () => {
    const [violation] = decisionsFor("unknown-scope.graphql");
    expect(violation?.location).toBe("fixture: Product.cost");
  });
});

describe("client operations against a schema", () => {
  const baseOperations = readdirSync(`${fixtures}breaking-rename/base-operations`).map((file) => ({
    path: `clients/operations/${file}`,
    content: fixture(`breaking-rename/base-operations/${file}`),
  }));

  it("a renamed field fails with the file, line, operation and a readable message", () => {
    const violations = validateOperations(
      schemaFrom(fixture("breaking-rename/proposed/schema.graphql")),
      baseOperations,
      "breaking/operation-no-longer-valid",
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.location).toBe("clients/operations/GetProducts.graphql:6:9");
    expect(violations[0]?.message).toBe('Cannot query field "name" on type "Product". (in query GetProducts)');
    expect(formatViolations(violations)).toContain("[breaking/operation-no-longer-valid] clients/operations/GetProducts.graphql:6:9");
  });

  it("the same operations pass against the schema before the rename", () => {
    const before = fixture("breaking-rename/proposed/schema.graphql").replace("title: String!", "name: String!");
    expect(validateOperations(schemaFrom(before), baseOperations, "x")).toEqual([]);
  });

  it("reports a file that does not parse instead of skipping it", () => {
    const [violation] = validateOperations(
      schemaFrom("type Query { a: Int }"),
      [{ path: "clients/operations/Broken.graphql", content: "query {" }],
      "operations/valid",
    );
    expect(violation?.message).toMatch(/^Syntax error/);
    expect(violation?.location).toContain("Broken.graphql");
  });

  it("flags changed argument requirements, not only renamed fields", () => {
    const violations = validateOperations(
      schemaFrom("type Query { products(first: Int!, region: String!): Int }"),
      [{ path: "clients/operations/P.graphql", content: "query P { products(first: 5) }" }],
      "x",
    );
    expect(violations.map((violation) => violation.message).join("\n")).toContain('"region" of type "String!" is required');
  });
});

describe("the repository as committed", () => {
  const apiSchema = apiSchemaFromSupergraph(readRepoFile("supergraph/supergraph.graphql"));

  it("passes the schema policy", () => {
    expect(checkPolicy(apiSchema), formatViolations(checkPolicy(apiSchema))).toEqual([]);
  });

  it("follows the decisions", () => {
    const violations = checkDecisions(loadSubgraphSdls(), vocabulary);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("has client operations that validate", () => {
    const files = loadOperationFiles();
    expect(files.length).toBeGreaterThan(0);
    const violations = validateOperations(apiSchema, files, "operations/valid");
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});
