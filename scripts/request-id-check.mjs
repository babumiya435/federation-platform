#!/usr/bin/env node
// Checks that the request id the router logs is the id the subgraphs receive, whether the
// client sends a usable id, none, or an unusable one. Reads `docker compose logs`, so it
// needs the stack started from this folder.
//   ROUTER_URL=http://localhost:4000/graphql node scripts/request-id-check.mjs
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createChecks, routerUrl, tokenFor } from "./lib/stack.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const { expect, finish } = createChecks();

// Own caller, so these queries do not count against the anonymous rate limit that the
// other scripts in this folder use.
const token = tokenFor("request-id-check");

const logLines = (service) =>
  execFileSync("docker", ["compose", "logs", "--no-log-prefix", service], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

/** Sends one query, with the given x-request-id header (or none), and returns the ids seen. */
async function send(headerValue) {
  const marker = `rid-probe-${Math.random().toString(36).slice(2, 10)}`;
  const before = { router: logLines("router").length, product: logLines("product").length };
  // The operation name makes this request findable among the router's log lines.
  await fetch(routerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(headerValue ? { "x-request-id": headerValue } : {}),
    },
    body: JSON.stringify({ query: `query ${marker.replace(/-/g, "_")} { products(first: 1) { edges { node { name } } } }` }),
  });
  await sleep(1000);

  const routerLine = logLines("router").slice(before.router).find((line) => line.includes('"target":"router::request"'));
  const routerId = routerLine && JSON.parse(routerLine).request_id;
  const subgraphLine = logLines("product").slice(before.product).find((line) => line.includes("request_id"));
  const subgraphId = subgraphLine && JSON.parse(subgraphLine).request_id;
  return { routerId, subgraphId };
}

let seen = await send("client-supplied-123");
expect("a usable client id is logged and forwarded unchanged", seen.routerId === "client-supplied-123" && seen.subgraphId === "client-supplied-123", seen);

seen = await send(undefined);
expect(
  "with no client id the subgraph receives the id the router logged",
  Boolean(seen.routerId) && seen.routerId === seen.subgraphId,
  seen,
);

seen = await send("not usable: has spaces");
expect(
  "an unusable client id is replaced, and the replacement is what the subgraph receives",
  Boolean(seen.routerId) && seen.routerId !== "not usable: has spaces" && seen.routerId === seen.subgraphId,
  seen,
);

finish("request id checks passed");
