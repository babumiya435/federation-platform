#!/usr/bin/env node
// Proves a limit can change without touching the router's source or restarting it:
// edit the supergraph the router is polling and watch the new limit take effect.
//   ROUTER_URL=http://localhost:4000/graphql node scripts/rate-limit-reload.mjs
//
// It rewrites supergraph/supergraph.graphql in place (same file, so the container's
// bind mount sees it) and always restores the original, even on failure.
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createChecks, post, tokenFor } from "./lib/stack.mjs";

const supergraphPath = fileURLToPath(new URL("../supergraph/supergraph.graphql", import.meta.url));
const POLL_WAIT_MS = 8000; // router polls every 5s

const original = readFileSync(supergraphPath, "utf8");
const PRODUCTS_LIMIT = "@rateLimit(limit: 5, windowSeconds: 10) @join__field(graph: PRODUCT)";
if (!original.includes(PRODUCTS_LIMIT)) {
  console.error("could not find the Query.products limit in the supergraph; update this script");
  process.exit(1);
}

const products = (sub) => post("{ products(first: 1) { edges { node { name } } } }", tokenFor(sub));
const callsUntilLimited = async (sub, max = 12) => {
  for (let call = 1; call <= max; call++) {
    if ((await products(sub)).status === 429) return call - 1; // calls that were served
  }
  return max;
};

const { expect, finish } = createChecks();

try {
  expect("baseline: the limit from the committed supergraph (5) applies", (await callsUntilLimited("rl-reload-0")) === 5, null);

  // 1. lower the limit by editing the supergraph only
  writeFileSync(supergraphPath, original.replace(PRODUCTS_LIMIT, "@rateLimit(limit: 3, windowSeconds: 10) @join__field(graph: PRODUCT)"));
  await sleep(POLL_WAIT_MS);
  expect("after the supergraph changes, the new limit (3) applies with no restart", (await callsUntilLimited("rl-reload-1")) === 3, null);

  // 2. an invalid directive must not take the router down or replace the working limits
  writeFileSync(supergraphPath, original.replace(PRODUCTS_LIMIT, "@rateLimit(limit: 0, windowSeconds: 10) @join__field(graph: PRODUCT)"));
  await sleep(POLL_WAIT_MS);
  const duringBadSupergraph = await callsUntilLimited("rl-reload-2");
  expect("an invalid @rateLimit is refused and the previous limit (3) stays in force", duringBadSupergraph === 3, { served: duringBadSupergraph });

  // 3. restoring the original brings the original limit back
  writeFileSync(supergraphPath, original);
  await sleep(POLL_WAIT_MS);
  expect("restoring the supergraph restores the limit (5)", (await callsUntilLimited("rl-reload-3")) === 5, null);
} finally {
  writeFileSync(supergraphPath, original);
}

finish("all reload checks passed");
