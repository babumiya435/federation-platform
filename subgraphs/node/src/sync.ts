import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { discoverNodeTypes, formatViolations, type SubgraphSource } from "./discover.js";
import { renderNodeSubgraphSchema } from "./render.js";

const subgraphsDir = fileURLToPath(new URL("../../", import.meta.url));
const target = fileURLToPath(new URL("../schema.graphql", import.meta.url));

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

const { typeNames, violations } = discoverNodeTypes(loadOtherSubgraphs());

if (violations.length > 0) {
  console.error(`Node rules violated (see docs/decisions/0004-node-subgraph.md):\n${formatViolations(violations)}`);
  process.exit(1);
}

const generated = renderNodeSubgraphSchema(typeNames);

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(target, "utf8");
  } catch {
    // treated as stale below
  }
  if (committed !== generated) {
    console.error(
      "subgraphs/node/schema.graphql is out of date with the other subgraphs.\nRun `pnpm graph:update` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`node schema.graphql is up to date (${typeNames.join(", ") || "no types"})`);
} else {
  writeFileSync(target, generated);
  console.log(`wrote ${target} with Node types: ${typeNames.join(", ") || "none"}`);
}
