import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { decodeGlobalId } from "@federation-platform/global-id";
import { parse, type GraphQLInterfaceType, type GraphQLResolveInfo } from "graphql";

const generatedSchemaPath = fileURLToPath(new URL("../schema.graphql", import.meta.url));

/**
 * Builds the node subgraph from its generated SDL. The set of resolvable types is the
 * set of possible types of `Node` in that SDL, so there is no second registry to keep
 * in sync (docs/decisions/0004-node-subgraph.md).
 */
export function buildNodeSchema(sdl: string = readFileSync(generatedSchemaPath, "utf8")) {
  return buildSubgraphSchema({
    typeDefs: parse(sdl),
    resolvers: {
      Query: {
        node: (_root: unknown, args: { id: string }, _context: unknown, info: GraphQLResolveInfo) => {
          const decoded = decodeGlobalId(args.id);
          if (!decoded) {
            return null;
          }
          const eligibleTypeNames = info.schema
            .getPossibleTypes(info.returnType as GraphQLInterfaceType)
            .map((type) => type.name);
          if (!eligibleTypeNames.includes(decoded.typeName)) {
            return null;
          }
          // A stub: the router fetches the real entity from the owning subgraph.
          return { __typename: decoded.typeName, id: args.id };
        },
      },
    },
  });
}
