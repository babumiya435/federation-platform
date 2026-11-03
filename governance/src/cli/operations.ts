import { apiSchemaFromSupergraph } from "../api-schema.js";
import { validateOperations } from "../operations.js";
import { finishCheck } from "../report.js";
import { loadOperationFiles, readRepoFile } from "../repo.js";

const files = loadOperationFiles();
const schema = apiSchemaFromSupergraph(readRepoFile("supergraph/supergraph.graphql"));

finishCheck(
  "operations",
  validateOperations(schema, files, "operations/valid"),
  `${files.length} client operation(s) in clients/operations validate against the schema`,
);
