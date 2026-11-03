import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { printSubgraphSchema } from "@apollo/subgraph";
import { schema } from "./schema.js";

const target = fileURLToPath(new URL("../schema.graphql", import.meta.url));
const generated = printSubgraphSchema(schema) + "\n";

if (process.argv.includes("--check")) {
  const committed = readFileSync(target, "utf8");
  if (committed !== generated) {
    console.error(
      "schema.graphql is out of date with the code.\nRun `pnpm graph:update` and commit the result.",
    );
    process.exit(1);
  }
  console.log("schema.graphql is up to date");
} else {
  writeFileSync(target, generated);
  console.log(`wrote ${target}`);
}
