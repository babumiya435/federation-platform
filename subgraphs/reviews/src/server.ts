import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { ReviewStore } from "./data.js";
import { type Context, schema } from "./schema.js";

const store = new ReviewStore();
const productsUrl = process.env.PRODUCT_SUBGRAPH_URL ?? "http://localhost:4001/graphql";
const yoga = createYoga<object, Context>({
  schema,
  graphqlEndpoint: "/graphql",
  context: ({ request }) => ({
    store,
    products: { url: productsUrl },
    requestId: request.headers.get("x-request-id"),
  }),
});
const port = Number(process.env.PORT ?? 4004);

createServer((request, response) => {
  // One line per GraphQL call, carrying the id the router forwards (docs/decisions/0005).
  if (request.method === "POST") {
    console.log(JSON.stringify({ service: "reviews", request_id: request.headers["x-request-id"] ?? null }));
  }
  return yoga(request, response);
}).listen(port, () => {
  console.log(`reviews subgraph listening on :${port}/graphql (products: ${productsUrl})`);
});
