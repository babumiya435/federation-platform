import { composeServices } from "@theguild/federation-composition";
import { parse } from "graphql";

export interface SubgraphInput {
  name: string;
  url: string;
  sdl: string;
}

export type CompositionResult =
  | { ok: true; supergraphSdl: string }
  | { ok: false; errors: string[] };

/** Composes subgraphs into a supergraph, turning library errors into readable lines. */
export function composeSupergraph(subgraphs: readonly SubgraphInput[]): CompositionResult {
  const result = composeServices(
    subgraphs.map((subgraph) => ({
      name: subgraph.name,
      url: subgraph.url,
      typeDefs: parse(subgraph.sdl),
    })),
  );

  if (result.errors && result.errors.length > 0) {
    return {
      ok: false,
      errors: result.errors.map((error) => {
        const code = (error.extensions as { code?: string } | undefined)?.code;
        return code ? `[${code}] ${error.message}` : error.message;
      }),
    };
  }
  if (!result.supergraphSdl) {
    return { ok: false, errors: ["Composition produced no supergraph and reported no errors."] };
  }
  return { ok: true, supergraphSdl: result.supergraphSdl };
}
