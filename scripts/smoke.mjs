#!/usr/bin/env node
// Smoke test against a running stack (docker compose up). Exits non-zero on failure.
//   ROUTER_URL=http://localhost:4000/graphql node scripts/smoke.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const routerUrl = process.env.ROUTER_URL ?? "http://localhost:4000/graphql";
const mintScript = fileURLToPath(new URL("./mint-token.mjs", import.meta.url));

const mint = (...args) => execFileSync("node", [mintScript, ...args], { encoding: "utf8" }).trim();
const globalId = (typeName, localId) => Buffer.from(`${typeName}:${localId}`).toString("base64url");

async function graphql(query, token) {
  const response = await fetch(routerUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query }),
  });
  return response.json();
}

const failures = [];
function expect(name, condition, detail) {
  console.log(`${condition ? "ok  " : "FAIL"} ${name}`);
  if (!condition) failures.push(`${name}: ${JSON.stringify(detail)}`);
}

const backpack = globalId("Product", "trail-backpack");
const missing = globalId("Product", "no-such-product");
const internal = mint("--sub", "alice", "--scope", "catalog:read:internal");

let result = await graphql("{ products(first: 2) { edges { node { name } } } }");
expect("anonymous can read public fields", result.data?.products?.edges?.length === 2, result);

result = await graphql("{ products(first: 1) { edges { node { internalCost } } } }");
expect("anonymous is refused a protected field", result.errors?.[0]?.extensions?.code === "UNAUTHORIZED_FIELD_OR_TYPE" && !result.data, result);

result = await graphql("{ products(first: 1) { edges { node { internalCost } } } }", internal);
expect("token with the scope can read it", typeof result.data?.products?.edges?.[0]?.node?.internalCost === "number", result);

result = await graphql("{ products(first: 1) { edges { node { internalCost } } } }", mint("--sub", "bob"));
expect("token without the scope is refused", Boolean(result.errors) && !result.data, result);

result = await graphql(`{ node(id: "${backpack}") { __typename ... on Product { name } } }`);
expect("node(id) resolves a Product", result.data?.node?.__typename === "Product" && result.data.node.name === "Trail Backpack", result);

result = await graphql(`{ node(id: "${backpack}") { ... on Product { internalCost } } }`);
expect("node(id) keeps protected fields protected", Boolean(result.errors) && !result.data, result);

result = await graphql(`{ node(id: "${backpack}") { ... on Product { internalCost } } }`, internal);
expect("node(id) serves them with the scope", typeof result.data?.node?.internalCost === "number", result);

result = await graphql(`{ node(id: "${missing}") { __typename id } }`);
expect("node(id) is null for an unknown product", result.data?.node === null && !result.errors, result);

result = await graphql(`{ node(id: "###") { id } }`);
expect("node(id) is null for a malformed id", result.data?.node === null && !result.errors, result);

result = await graphql(`{ node(id: "${globalId("Review", "insulated-bottle-review-1")}") { ... on Review { rating product { name } } } }`);
expect("node(id) resolves a Review and its product", result.data?.node?.product?.name === "Insulated Bottle", result);

result = await graphql("{ products(first: 1) { edges { node { name } } } }", `${internal}x`);
expect("a tampered token is treated as anonymous", result.data?.products?.edges?.length === 1, result);

result = await graphql("{ products(first: 1) { edges { node { internalCost } } } }", `${internal}x`);
expect("a tampered token grants no scopes", Boolean(result.errors) && !result.data, result);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("\nall smoke checks passed");
