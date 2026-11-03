import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { buildNodeSchema, type NodeContext } from "./schema.js";

const yoga = createYoga<object, NodeContext>({
  schema: buildNodeSchema(),
  graphqlEndpoint: "/graphql",
  context: ({ request }) => ({ requestId: request.headers.get("x-request-id") }),
});
const port = Number(process.env.PORT ?? 4002);

createServer(yoga).listen(port, () => {
  console.log(`node subgraph listening on :${port}/graphql`);
});
