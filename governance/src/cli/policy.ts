import { apiSchemaFromSupergraph } from "../api-schema.js";
import { checkPolicy } from "../policy.js";
import { finishCheck } from "../report.js";
import { readRepoFile } from "../repo.js";

const schema = apiSchemaFromSupergraph(readRepoFile("supergraph/supergraph.graphql"));
finishCheck("policy", checkPolicy(schema), "the API schema follows the schema policy");
