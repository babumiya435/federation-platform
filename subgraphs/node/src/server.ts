import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createYoga } from "graphql-yoga";
import { ownerLookup } from "./owners.js";
import { buildNodeSchema, type NodeContext } from "./schema.js";

// The same composed supergraph the router follows. In compose it is mounted at this path.
const supergraphPath =
  process.env.SUPERGRAPH_PATH ?? fileURLToPath(new URL("../../../supergraph/supergraph.graphql", import.meta.url));

const yoga = createYoga<object, NodeContext>({
  schema: buildNodeSchema({ ownerUrls: ownerLookup(supergraphPath) }),
  graphqlEndpoint: "/graphql",
  context: ({ request }) => ({ requestId: request.headers.get("x-request-id") }),
});
const port = Number(process.env.PORT ?? 4002);

createServer((request, response) => {
  // One line per GraphQL call, carrying the id the router forwards (docs/decisions/0005).
  if (request.method === "POST") {
    console.log(JSON.stringify({ service: "node", request_id: request.headers["x-request-id"] ?? null }));
  }
  return yoga(request, response);
}).listen(port, () => {
  console.log(`node subgraph listening on :${port}/graphql (supergraph: ${supergraphPath})`);
});
