#!/usr/bin/env node
// End to end: add a new Node type in a different subgraph, run the update workflow,
// and resolve an instance of it through the real router's node(id), with nobody editing
// the node subgraph by hand. Also shows that a declaration breaking the Node rules is
// rejected by the same workflow.
//
//   node e2e/add-node-type/run.mjs            (ROUTER_PORT=4100 if 4000 is taken)
//
// It adds a throwaway `gadgets` subgraph (from ./template), and puts everything back
// afterwards, including on failure. It refuses to start if tracked files are modified,
// because it restores them with `git checkout`.
import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createChecks, globalId, post } from "../../scripts/lib/stack.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const templateDir = fileURLToPath(new URL("./template/", import.meta.url));
const gadgetsDir = `${repoRoot}subgraphs/gadgets`;
const registryPath = `${repoRoot}governance/subgraphs.json`;
const COMPOSE = ["-f", "docker-compose.yml", "-f", "e2e/add-node-type/compose.gadgets.yml"];

// Files the update workflow rewrites; restored from git at the end.
const TOUCHED = [
  "governance/subgraphs.json",
  "subgraphs/node/schema.graphql",
  "subgraphs/node/owners.json",
  "supergraph/supergraph.graphql",
  "pnpm-lock.yaml",
];

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function restoreRepository() {
  rmSync(gadgetsDir, { recursive: true, force: true });
  run("git", ["checkout", "--", ...TOUCHED]);
}

function addGadgetsSubgraph(transformSchema = (sdl) => sdl) {
  cpSync(templateDir, gadgetsDir, { recursive: true });
  const schemaPath = `${gadgetsDir}/schema.graphql`;
  writeFileSync(schemaPath, transformSchema(readFileSync(schemaPath, "utf8")));
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  registry.push({ name: "gadgets", url: "http://gadgets:4003/graphql" });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
}

const { expect, finish } = createChecks();

if (run("git", ["status", "--porcelain", "--untracked-files=no"], { capture: true }).output.trim() !== "") {
  console.error("Tracked files are modified. Commit or stash them first: this script restores files with `git checkout`.");
  process.exit(2);
}
if (readFileSync(`${repoRoot}subgraphs/node/schema.graphql`, "utf8").includes("Gadget")) {
  console.error("The node subgraph already mentions Gadget; nothing to demonstrate.");
  process.exit(2);
}

try {
  // 1. a declaration that breaks the Node rules is rejected by the update workflow
  console.log("\n# a Node type with no resolvable @key(fields: \"id\") is rejected");
  addGadgetsSubgraph((sdl) => sdl.replace(' @key(fields: "id")', ""));
  const rejected = run("pnpm", ["graph:update"], { capture: true });
  expect("graph:update fails for a Node type nobody can resolve", rejected.status !== 0, rejected.output.slice(-400));
  expect(
    "and says which rule, which type and how to fix it",
    /\[N2\]/.test(rejected.output) && rejected.output.includes('"Gadget"') && rejected.output.includes('@key(fields: "id")'),
    rejected.output.slice(-600),
  );
  restoreRepository();

  // 2. a valid new Node type flows through with no hand edits to the node subgraph
  console.log("\n# a valid new Node type, added in another subgraph");
  addGadgetsSubgraph();
  const installed = run("pnpm", ["install", "--no-frozen-lockfile"], { capture: true });
  expect("the new subgraph installs into the workspace", installed.status === 0, installed.output.slice(-400));
  const updated = run("pnpm", ["graph:update"], { capture: true });
  expect("graph:update succeeds", updated.status === 0, updated.output.slice(-600));

  const changedInNode = run("git", ["diff", "--name-only", "--", "subgraphs/node"], { capture: true })
    .output.trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  expect(
    "only generated files changed in the node subgraph",
    JSON.stringify(changedInNode) === JSON.stringify(["subgraphs/node/owners.json", "subgraphs/node/schema.graphql"]),
    changedInNode,
  );
  expect(
    "the node subgraph schema now declares Gadget and the supergraph contains it",
    readFileSync(`${repoRoot}subgraphs/node/schema.graphql`, "utf8").includes("type Gadget implements Node") &&
      readFileSync(`${repoRoot}supergraph/supergraph.graphql`, "utf8").includes("type Gadget"),
    null,
  );

  // 3. resolve it through the real router
  console.log("\n# through the router");
  for (const service of ["router", "product"]) {
    if (run("docker", ["image", "inspect", `federation-platform/${service}:local`], { capture: true }).status !== 0) {
      run("docker", ["compose", "build", service]);
    }
  }
  const built = run("docker", ["compose", ...COMPOSE, "build", "node", "gadgets"]);
  const started = run("docker", ["compose", ...COMPOSE, "up", "-d", "--no-build", "--wait"]);
  expect("the stack with the new subgraph starts and becomes healthy", built.status === 0 && started.status === 0, null);

  let result = await post(`{ node(id: "${globalId("Gadget", "sprocket")}") { __typename id ... on Gadget { name } } }`);
  expect(
    "node(id) resolves the new Gadget through the router",
    result.body.data?.node?.__typename === "Gadget" && result.body.data.node.name === "Sprocket",
    result.body,
  );
  result = await post(`{ node(id: "${globalId("Gadget", "no-such-gadget")}") { __typename } }`);
  expect("node(id) is null for a Gadget that does not exist", result.body.data?.node === null && !result.body.errors, result.body);
  result = await post(`{ node(id: "${globalId("Product", "trail-backpack")}") { ... on Product { name } } }`);
  expect("existing Node types still resolve", result.body.data?.node?.name === "Trail Backpack", result.body);
} finally {
  run("docker", ["compose", ...COMPOSE, "down", "-v", "--remove-orphans"], { capture: true });
  restoreRepository();
  run("pnpm", ["install", "--frozen-lockfile"], { capture: true });
}

finish("add-node-type scenario passed");
