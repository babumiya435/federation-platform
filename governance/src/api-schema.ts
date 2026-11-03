import { buildASTSchema, parse, type GraphQLSchema } from "graphql";
import { transformSupergraphToPublicSchema } from "@theguild/federation-composition";

/** The schema clients see: the supergraph without federation machinery. */
export function apiSchemaFromSupergraph(supergraphSdl: string): GraphQLSchema {
  return buildASTSchema(transformSupergraphToPublicSchema(parse(supergraphSdl)));
}
