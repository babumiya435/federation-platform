import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { decodeGlobalId } from "@federation-platform/global-id";
import { parse } from "graphql";
import { createYoga } from "graphql-yoga";

// A throwaway subgraph used only by e2e/add-node-type: it owns one new Node type.
const gadgets = new Map([
  ["sprocket", "Sprocket"],
  ["flange", "Flange"],
]);

const schema = buildSubgraphSchema({
  typeDefs: parse(readFileSync(fileURLToPath(new URL("../schema.graphql", import.meta.url)), "utf8")),
  resolvers: {
    Query: { gadgetCount: () => gadgets.size },
    Gadget: {
      __resolveReference: (reference: { id: string }) => {
        const decoded = decodeGlobalId(reference.id);
        const name = decoded?.typeName === "Gadget" ? gadgets.get(decoded.localId) : undefined;
        return name ? { id: reference.id, name } : null;
      },
    },
  },
});

const yoga = createYoga({ schema, graphqlEndpoint: "/graphql" });
const port = Number(process.env.PORT ?? 4003);

createServer(yoga).listen(port, () => {
  console.log(`gadgets subgraph listening on :${port}/graphql`);
});
