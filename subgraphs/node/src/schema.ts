import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { decodeGlobalId } from "@federation-platform/global-id";
import { GraphQLError, parse, type GraphQLInterfaceType, type GraphQLResolveInfo } from "graphql";

const generatedSchemaPath = fileURLToPath(new URL("../schema.graphql", import.meta.url));
const generatedOwnersPath = fileURLToPath(new URL("../owners.json", import.meta.url));

/** Type name -> URLs of the subgraphs that can resolve it by id. Generated, never edited. */
export type OwnerMap = Record<string, string[]>;

export interface NodeContext {
  /** Forwarded to the owner so one request id spans the whole call chain. */
  requestId?: string | null;
}

export interface NodeSchemaOptions {
  sdl?: string;
  owners?: OwnerMap;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const EXISTS_QUERY = `query NodeExists($representations: [_Any!]!) {
  _entities(representations: $representations) { __typename }
}`;

/**
 * Asks one owner whether it has the entity. A subgraph answers `null` from
 * `_entities` for an id it does not know. Anything else (HTTP error, GraphQL error,
 * timeout) throws: reporting "not found" for an owner that is down would be a lie.
 */
async function ownerHasEntity(
  ownerUrl: string,
  typeName: string,
  id: string,
  context: NodeContext,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<boolean> {
  const response = await fetchImpl(ownerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(context.requestId ? { "x-request-id": context.requestId } : {}),
    },
    body: JSON.stringify({
      query: EXISTS_QUERY,
      variables: { representations: [{ __typename: typeName, id }] },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Owner of ${typeName} (${ownerUrl}) answered HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    data?: { _entities?: (unknown | null)[] };
    errors?: { message: string }[];
  };
  if (body.errors?.length) {
    throw new Error(`Owner of ${typeName} (${ownerUrl}) failed: ${body.errors[0]?.message}`);
  }
  return Boolean(body.data?._entities?.[0]);
}

/**
 * Builds the node subgraph from its generated artifacts. The eligible types are the
 * possible types of `Node` in the generated SDL; `owners` says who to ask about each
 * (docs/decisions/0004-node-subgraph.md).
 */
export function buildNodeSchema(options: NodeSchemaOptions = {}) {
  const sdl = options.sdl ?? readFileSync(generatedSchemaPath, "utf8");
  const owners: OwnerMap =
    options.owners ?? (JSON.parse(readFileSync(generatedOwnersPath, "utf8")) as OwnerMap);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2000;

  return buildSubgraphSchema({
    typeDefs: parse(sdl),
    resolvers: {
      Query: {
        node: async (
          _root: unknown,
          args: { id: string },
          context: unknown,
          info: GraphQLResolveInfo,
        ) => {
          const nodeContext = context as NodeContext;
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

          const ownerUrls = owners[decoded.typeName] ?? [];
          let answers: boolean[];
          try {
            answers = await Promise.all(
              ownerUrls.map((ownerUrl) =>
                ownerHasEntity(ownerUrl, decoded.typeName, args.id, nodeContext, fetchImpl, timeoutMs),
              ),
            );
          } catch (error) {
            // Detail stays in the server log; the client gets a stable, safe error.
            console.error(`node(${decoded.typeName}) owner check failed:`, error);
            throw new GraphQLError("Could not verify this id with its owning subgraph.", {
              extensions: { code: "NODE_OWNER_UNAVAILABLE" },
            });
          }
          if (!answers.some(Boolean)) {
            return null;
          }
          // A stub: the router fetches the real entity from the owner(s).
          return { __typename: decoded.typeName, id: args.id };
        },
      },
    },
  });
}
