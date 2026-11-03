import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { CatalogStore } from "./data.js";
import { schema } from "./schema.js";

const store = new CatalogStore();
const yoga = createYoga({ schema, context: () => ({ store }), graphqlEndpoint: "/graphql" });
const port = Number(process.env.PORT ?? 4001);

createServer((request, response) => {
  // One line per GraphQL call, carrying the id the router forwards (docs/decisions/0005).
  if (request.method === "POST") {
    console.log(JSON.stringify({ service: "product", request_id: request.headers["x-request-id"] ?? null }));
  }
  return yoga(request, response);
}).listen(port, () => {
  console.log(`product subgraph listening on :${port}/graphql`);
});
