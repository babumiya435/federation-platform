import { finishCheck } from "../report.js";
import { loadSubgraphSdls } from "../repo.js";
import { checkNodeRules } from "../node-rules.js";

const subgraphs = loadSubgraphSdls();
finishCheck(
  "node-rules",
  checkNodeRules(subgraphs),
  `${subgraphs.length} subgraph schema(s) follow the Node pattern`,
);
