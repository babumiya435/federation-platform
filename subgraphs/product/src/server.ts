import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { CatalogStore } from "./data.js";
import { schema } from "./schema.js";

const store = new CatalogStore();
const yoga = createYoga({ schema, context: () => ({ store }), graphqlEndpoint: "/graphql" });
const port = Number(process.env.PORT ?? 4001);

createServer(yoga).listen(port, () => {
  console.log(`product subgraph listening on :${port}/graphql`);
});
