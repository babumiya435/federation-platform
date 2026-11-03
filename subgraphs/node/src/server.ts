import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { buildNodeSchema } from "./schema.js";

const yoga = createYoga({ schema: buildNodeSchema(), graphqlEndpoint: "/graphql" });
const port = Number(process.env.PORT ?? 4002);

createServer(yoga).listen(port, () => {
  console.log(`node subgraph listening on :${port}/graphql`);
});
