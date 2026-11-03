import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { decodeGlobalId } from "@federation-platform/global-id";
import { entityExists } from "@federation-platform/owner-check";
import { GraphQLError, parse } from "graphql";

const staticSchemaPath = fileURLToPath(new URL("../schema.graphql", import.meta.url));

export interface NodeContext {
  /** Forwarded to the owners so one request id spans the whole call chain. */
  requestId?: string | null;
}

export interface NodeSchemaOptions {
  /** The subgraphs that own Node entities, normally read from the live supergraph. */
  ownerUrls: () => string[];
  sdl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The node subgraph: `Query.node(id)` returns a bare `{ id }` for the router, which then asks the
 * owning subgraphs for the concrete type and fields. Before that we ask the owners whether the id
 * is theirs at all, so an unknown id returns null: without it the router answers with a stub
 * typed `Node`, an interface name that no entity can have (docs/decisions/0010).
 */
export function buildNodeSchema(options: NodeSchemaOptions) {
  const sdl = options.sdl ?? readFileSync(staticSchemaPath, "utf8");

  return buildSubgraphSchema({
    typeDefs: parse(sdl),
    resolvers: {
      Query: {
        node: async (_root: unknown, args: { id: string }, context: unknown) => {
          const { requestId } = context as NodeContext;
          if (!decodeGlobalId(args.id)) {
            return null;
          }
          let owned: boolean;
          try {
            const answers = await Promise.all(
              options.ownerUrls().map((ownerUrl) =>
                entityExists({
                  ownerUrl,
                  typeName: "Node",
                  id: args.id,
                  requestId,
                  fetchImpl: options.fetchImpl,
                  timeoutMs: options.timeoutMs,
                }),
              ),
            );
            owned = answers.some(Boolean);
          } catch (error) {
            // Detail stays in the server log; the client gets a stable, safe error.
            console.error("node(id) owner check failed:", error);
            throw new GraphQLError("Could not verify this id with its owning subgraph.", {
              extensions: { code: "NODE_OWNER_UNAVAILABLE" },
            });
          }
          return owned ? { id: args.id } : null;
        },
      },
      // When the router needs a Node's id from this subgraph, the id is all there is.
      Node: { __resolveReference: (reference: { id: string }) => ({ id: reference.id }) },
    },
  });
}
