import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { discoverNodeTypes, formatViolations, type SubgraphSource } from "./discover.js";
import { renderNodeSubgraphSchema } from "./render.js";

const subgraphsDir = fileURLToPath(new URL("../../", import.meta.url));
const registryPath = fileURLToPath(new URL("../../../governance/subgraphs.json", import.meta.url));
const schemaTarget = fileURLToPath(new URL("../schema.graphql", import.meta.url));
const ownersTarget = fileURLToPath(new URL("../owners.json", import.meta.url));

function loadOtherSubgraphs(): SubgraphSource[] {
  return readdirSync(subgraphsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node")
    .flatMap((entry) => {
      try {
        const sdl = readFileSync(`${subgraphsDir}${entry.name}/schema.graphql`, "utf8");
        return [{ name: entry.name, sdl }];
      } catch {
        return []; // a subgraph without a committed schema has no Node types to offer
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { typeNames, owners, violations } = discoverNodeTypes(loadOtherSubgraphs());

if (violations.length > 0) {
  fail(`Node rules violated (see docs/decisions/0004-node-subgraph.md):\n${formatViolations(violations)}`);
}

// Owners are written as URLs so the running node subgraph needs no other config.
const registry = JSON.parse(readFileSync(registryPath, "utf8")) as { name: string; url: string }[];
const urlBySubgraph = new Map(registry.map((entry) => [entry.name, entry.url]));
const ownerUrls: Record<string, string[]> = {};
for (const [typeName, subgraphs] of Object.entries(owners)) {
  ownerUrls[typeName] = subgraphs.map((subgraph) => {
    const url = urlBySubgraph.get(subgraph);
    if (!url) {
      fail(`Subgraph "${subgraph}" owns Node type ${typeName} but is missing from governance/subgraphs.json.`);
    }
    return url;
  });
}

const generatedSchema = renderNodeSubgraphSchema(typeNames);
const generatedOwners = JSON.stringify(ownerUrls, null, 2) + "\n";

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

if (process.argv.includes("--check")) {
  if (readOrEmpty(schemaTarget) !== generatedSchema || readOrEmpty(ownersTarget) !== generatedOwners) {
    fail(
      "subgraphs/node/schema.graphql or owners.json is out of date with the other subgraphs.\nRun `pnpm graph:update` and commit the result.",
    );
  }
  console.log(`node schema.graphql and owners.json are up to date (${typeNames.join(", ") || "no types"})`);
} else {
  writeFileSync(schemaTarget, generatedSchema);
  writeFileSync(ownersTarget, generatedOwners);
  console.log(`wrote node schema.graphql and owners.json for: ${typeNames.join(", ") || "none"}`);
}
