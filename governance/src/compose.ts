import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { composeSupergraph, type SubgraphInput } from "./composition.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const registryPath = fileURLToPath(new URL("../subgraphs.json", import.meta.url));
const target = `${repoRoot}supergraph/supergraph.graphql`;

function fail(lines: string[]): never {
  console.error(lines.join("\n"));
  process.exit(1);
}

const registry = JSON.parse(readFileSync(registryPath, "utf8")) as { name: string; url: string }[];

// A subgraph directory with a schema but no entry in the registry would silently be
// left out of the supergraph; refuse instead.
const onDisk = readdirSync(`${repoRoot}subgraphs`, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const unregistered = onDisk.filter((name) => !registry.some((entry) => entry.name === name));
if (unregistered.length > 0) {
  fail([
    `Subgraph(s) not listed in governance/subgraphs.json: ${unregistered.join(", ")}.`,
    "Add a { name, url } entry so they are composed into the supergraph.",
  ]);
}

const subgraphs: SubgraphInput[] = registry.map((entry) => ({
  ...entry,
  sdl: readFileSync(`${repoRoot}subgraphs/${entry.name}/schema.graphql`, "utf8"),
}));

const result = composeSupergraph(subgraphs);
if (!result.ok) {
  fail(["Composition failed:", ...result.errors.map((error) => `  ${error}`)]);
}

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(target, "utf8");
  } catch {
    // treated as stale below
  }
  if (committed !== result.supergraphSdl) {
    fail([
      "supergraph/supergraph.graphql is out of date with the subgraph schemas.",
      "Run `pnpm graph:update` and commit the result.",
    ]);
  }
  console.log("supergraph.graphql composes and is up to date");
} else {
  writeFileSync(target, result.supergraphSdl);
  console.log(`wrote ${target}`);
}
