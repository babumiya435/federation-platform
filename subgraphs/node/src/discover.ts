import {
  Kind,
  parse,
  type DirectiveNode,
  type FieldDefinitionNode,
  type InterfaceTypeDefinitionNode,
  type ObjectTypeDefinitionNode,
  type ObjectTypeExtensionNode,
  type TypeNode,
} from "graphql";

/** One subgraph's schema, as committed. */
export interface SubgraphSource {
  name: string;
  sdl: string;
}

export interface NodeViolation {
  rule: "N1" | "N2" | "N3" | "N4";
  subgraph: string;
  typeName: string;
  message: string;
}

export interface DiscoveryResult {
  /** Sorted names of every eligible type. Only trustworthy when `violations` is empty. */
  typeNames: string[];
  violations: NodeViolation[];
}

const RESERVED_TYPE_NAMES = new Set(["Node", "Query", "Mutation", "Subscription"]);

type ObjectDefinition = ObjectTypeDefinitionNode | ObjectTypeExtensionNode;

interface TypeUsage {
  /** Subgraphs where the type declares `implements Node`. */
  implementedIn: Set<string>;
  /** Subgraphs where the type has a resolvable `@key(fields: "id")`. */
  resolvableIdKeyIn: Set<string>;
}

function isNonNullId(type: TypeNode): boolean {
  return (
    type.kind === Kind.NON_NULL_TYPE &&
    type.type.kind === Kind.NAMED_TYPE &&
    type.type.name.value === "ID"
  );
}

function findField(fields: readonly FieldDefinitionNode[] | undefined, name: string) {
  return fields?.find((field) => field.name.value === name);
}

/** True for `@key(fields: "id")` that is not `resolvable: false`. */
function isResolvableIdKey(directive: DirectiveNode): boolean {
  if (directive.name.value !== "key") {
    return false;
  }
  const fieldsArgument = directive.arguments?.find((argument) => argument.name.value === "fields");
  if (fieldsArgument?.value.kind !== Kind.STRING || fieldsArgument.value.value.trim() !== "id") {
    return false;
  }
  const resolvableArgument = directive.arguments?.find(
    (argument) => argument.name.value === "resolvable",
  );
  return !(
    resolvableArgument?.value.kind === Kind.BOOLEAN && resolvableArgument.value.value === false
  );
}

function checkNodeInterface(
  definition: InterfaceTypeDefinitionNode,
  subgraph: string,
  violations: NodeViolation[],
): void {
  const fields = definition.fields ?? [];
  const idField = findField(fields, "id");
  const exact = fields.length === 1 && idField !== undefined && isNonNullId(idField.type);
  if (!exact) {
    violations.push({
      rule: "N4",
      subgraph,
      typeName: "Node",
      message: `interface Node in subgraph "${subgraph}" must be exactly \`interface Node { id: ID! }\`.`,
    });
  }
}

/**
 * Finds every type that implements Node across the given subgraphs and checks the
 * rules in docs/decisions/0004-node-subgraph.md.
 */
export function discoverNodeTypes(sources: readonly SubgraphSource[]): DiscoveryResult {
  const violations: NodeViolation[] = [];
  const usageByType = new Map<string, TypeUsage>();

  const usageFor = (typeName: string): TypeUsage => {
    let usage = usageByType.get(typeName);
    if (!usage) {
      usage = { implementedIn: new Set(), resolvableIdKeyIn: new Set() };
      usageByType.set(typeName, usage);
    }
    return usage;
  };

  for (const { name: subgraph, sdl } of sources) {
    const document = parse(sdl);

    for (const definition of document.definitions) {
      if (definition.kind === Kind.INTERFACE_TYPE_DEFINITION && definition.name.value === "Node") {
        checkNodeInterface(definition, subgraph, violations);
        continue;
      }

      if (
        definition.kind !== Kind.OBJECT_TYPE_DEFINITION &&
        definition.kind !== Kind.OBJECT_TYPE_EXTENSION
      ) {
        continue;
      }
      const objectDefinition: ObjectDefinition = definition;
      const typeName = objectDefinition.name.value;
      const implementsNode = objectDefinition.interfaces?.some(
        (reference) => reference.name.value === "Node",
      );

      if (objectDefinition.directives?.some(isResolvableIdKey)) {
        usageFor(typeName).resolvableIdKeyIn.add(subgraph);
      }
      if (!implementsNode) {
        continue;
      }
      usageFor(typeName).implementedIn.add(subgraph);

      if (RESERVED_TYPE_NAMES.has(typeName)) {
        violations.push({
          rule: "N3",
          subgraph,
          typeName,
          message: `Type "${typeName}" in subgraph "${subgraph}" implements Node but uses a reserved type name.`,
        });
      }
      const idField = findField(objectDefinition.fields, "id");
      if (!idField || !isNonNullId(idField.type)) {
        violations.push({
          rule: "N1",
          subgraph,
          typeName,
          message: `Type "${typeName}" in subgraph "${subgraph}" implements Node, so it must have a field \`id: ID!\`.`,
        });
      }
    }
  }

  const typeNames: string[] = [];
  for (const [typeName, usage] of usageByType) {
    if (usage.implementedIn.size === 0) {
      continue;
    }
    typeNames.push(typeName);
    if (usage.resolvableIdKeyIn.size === 0) {
      const [subgraph] = [...usage.implementedIn];
      violations.push({
        rule: "N2",
        subgraph: subgraph ?? "unknown",
        typeName,
        message:
          `Type "${typeName}" implements Node (subgraph "${subgraph}") but no subgraph declares a resolvable ` +
          `@key(fields: "id") on it, so the router cannot resolve node(id) for it. ` +
          `Add @key(fields: "id") to the type in the subgraph that owns it.`,
      });
    }
  }

  return { typeNames: typeNames.sort(), violations };
}

export function formatViolations(violations: readonly NodeViolation[]): string {
  return violations.map((violation) => `  [${violation.rule}] ${violation.message}`).join("\n");
}
