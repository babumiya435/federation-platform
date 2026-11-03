import { checkDecisions } from "../decisions.js";
import { finishCheck } from "../report.js";
import { loadSubgraphSdls, readRepoFile } from "../repo.js";

const vocabulary = Object.keys(JSON.parse(readRepoFile("governance/scopes.json")) as Record<string, string>);
const subgraphs = loadSubgraphSdls();

finishCheck(
  "decisions",
  checkDecisions(subgraphs, vocabulary),
  `${subgraphs.length} subgraph schema(s) follow the @requiresScopes and @rateLimit decisions`,
);
