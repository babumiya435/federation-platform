import { apiSchemaFromSupergraph } from "../api-schema.js";
import { validateOperations } from "../operations.js";
import { finishCheck } from "../report.js";
import { BaseRefError, loadOperationFilesAtRef, readRepoFile, resolveBaseRef } from "../repo.js";

const baseArgument = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : undefined;

let base;
try {
  base = resolveBaseRef(baseArgument || process.env.GOVERNANCE_BASE_REF || undefined);
} catch (error) {
  if (error instanceof BaseRefError) {
    console.error(`breaking-changes failed: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

const baseOperations = loadOperationFilesAtRef(base.ref);
const schema = apiSchemaFromSupergraph(readRepoFile("supergraph/supergraph.graphql"));

// Name the base in every message so a reader knows which copy of the operations broke.
const violations = validateOperations(schema, baseOperations, "breaking/operation-no-longer-valid").map(
  (violation) => ({
    ...violation,
    message: `${violation.message} [operation exists on ${base.ref} @ ${base.sha}; this change would break it]`,
  }),
);

finishCheck(
  "breaking-changes",
  violations,
  baseOperations.length === 0
    ? `${base.ref} @ ${base.sha} has no client operations yet, so there is nothing to break`
    : `${baseOperations.length} operation(s) from ${base.ref} @ ${base.sha} still validate against the proposed schema`,
);
