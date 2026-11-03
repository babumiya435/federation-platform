import { readFileSync } from "node:fs";
import { Kind, parse, type ConstDirectiveNode } from "graphql";

function argument(directive: ConstDirectiveNode | undefined, name: string) {
  return directive?.arguments?.find((candidate) => candidate.name.value === name)?.value;
}

/**
 * The URLs of the subgraphs that own `Node` entities, read from a composed supergraph: every
 * subgraph that declares the `Node` interface as an entity interface, except the node subgraph
 * itself (the interface object). New entity types never change this list, and a new subgraph
 * appears in it as soon as it is composed in, so this subgraph needs no configuration for either.
 */
export function nodeOwnerUrls(supergraphSdl: string): string[] {
  const urlByGraph = new Map<string, string>();
  const ownerGraphs: string[] = [];

  for (const definition of parse(supergraphSdl).definitions) {
    if (definition.kind === Kind.ENUM_TYPE_DEFINITION && definition.name.value === "join__Graph") {
      for (const value of definition.values ?? []) {
        const graph = value.directives?.find((directive) => directive.name.value === "join__graph");
        const url = argument(graph, "url");
        if (url?.kind === Kind.STRING) urlByGraph.set(value.name.value, url.value);
      }
    }
    if (definition.kind === Kind.INTERFACE_TYPE_DEFINITION && definition.name.value === "Node") {
      for (const directive of definition.directives ?? []) {
        if (directive.name.value !== "join__type") continue;
        const isInterfaceObject = argument(directive, "isInterfaceObject");
        const graph = argument(directive, "graph");
        if (isInterfaceObject?.kind === Kind.BOOLEAN && isInterfaceObject.value) continue;
        if (graph?.kind === Kind.ENUM) ownerGraphs.push(graph.value);
      }
    }
  }

  const urls = ownerGraphs.flatMap((graph) => urlByGraph.get(graph) ?? []);
  return [...new Set(urls)].sort();
}

/**
 * A lookup that re-reads the supergraph file on every call and re-parses only when its content
 * changed, so a recomposed supergraph is picked up as soon as the router sees it. It compares
 * content, not timestamps: a replaced file can show new content with an old timestamp on some
 * Docker setups (docs/decisions/0005).
 */
export function ownerLookup(supergraphPath: string): () => string[] {
  let cached: { text: string; urls: string[] } | undefined;
  return () => {
    const text = readFileSync(supergraphPath, "utf8");
    if (cached?.text !== text) cached = { text, urls: nodeOwnerUrls(text) };
    return cached.urls;
  };
}
