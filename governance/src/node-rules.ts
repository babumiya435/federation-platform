import {
  Kind,
  parse,
  type ConstDirectiveNode,
  type DefinitionNode,
  type FieldDefinitionNode,
  type TypeNode,
} from "graphql";
import type { SubgraphSdl } from "./decisions.js";
import type { Violation } from "./report.js";

/**
 * Rules for the Node pattern (docs/decisions/0010-node-interface-object.md). `node(id)` works
 * for any entity type, in any subgraph, without touching the node subgraph, as long as each
 * subgraph that owns a Node type says so in the one way the router understands:
 *
 *  - the type `implements Node`, has `id: ID!` and a resolvable `@key(fields: "id")`;
 *  - the subgraph declares `interface Node @key(fields: "id")`, the entity interface the router
 *    asks "is this bare id yours?";
 *  - exactly `{ id: ID! }` everywhere, and one subgraph serves `Query.node` through
 *    `type Node @key(fields: "id") @interfaceObject`.
 */

const RESERVED_TYPE_NAMES = new Set(["Node", "Query", "Mutation", "Subscription"]);

function isNonNullId(type: TypeNode): boolean {
  return type.kind === Kind.NON_NULL_TYPE && type.type.kind === Kind.NAMED_TYPE && type.type.name.value === "ID";
}

function onlyIdField(fields: readonly FieldDefinitionNode[] | undefined): boolean {
  return fields?.length === 1 && fields[0]?.name.value === "id" && isNonNullId(fields[0].type);
}

/** `@key(fields: "id")` that is not `resolvable: false`. */
function isResolvableIdKey(directive: ConstDirectiveNode): boolean {
  if (directive.name.value !== "key") return false;
  const fields = directive.arguments?.find((argument) => argument.name.value === "fields")?.value;
  if (fields?.kind !== Kind.STRING || fields.value.trim() !== "id") return false;
  const resolvable = directive.arguments?.find((argument) => argument.name.value === "resolvable")?.value;
  return !(resolvable?.kind === Kind.BOOLEAN && resolvable.value === false);
}

type Definition = DefinitionNode & { name?: { value: string }; directives?: readonly ConstDirectiveNode[] };

export function checkNodeRules(subgraphs: readonly SubgraphSdl[]): Violation[] {
  const violations: Violation[] = [];
  let anySubgraphImplementsNode = false;
  let interfaceObjectSeen = false;

  for (const { name: subgraph, sdl } of subgraphs) {
    const add = (rule: string, typeName: string, message: string) =>
      violations.push({ rule: `node/${rule}`, location: `${subgraph}: ${typeName}`, message });

    const definitions = parse(sdl).definitions as Definition[];
    let entityInterfaceDeclared = false;
    const implementing: Definition[] = [];

    for (const definition of definitions) {
      const typeName = definition.name?.value;
      if (!typeName) continue;

      if (definition.kind === Kind.INTERFACE_TYPE_DEFINITION && typeName === "Node") {
        if (!onlyIdField(definition.fields)) {
          add("interface-shape", "Node", "interface Node must be exactly `{ id: ID! }`.");
        }
        if (definition.directives?.some(isResolvableIdKey)) entityInterfaceDeclared = true;
      }

      if (
        (definition.kind === Kind.OBJECT_TYPE_DEFINITION || definition.kind === Kind.OBJECT_TYPE_EXTENSION) &&
        typeName === "Node" &&
        definition.directives?.some((directive) => directive.name.value === "interfaceObject")
      ) {
        interfaceObjectSeen = true;
        if (!onlyIdField(definition.fields) || !definition.directives.some(isResolvableIdKey)) {
          add("interface-object-shape", "Node", 'the interface object must be `type Node @key(fields: "id") @interfaceObject { id: ID! }`.');
        }
      }

      if (
        (definition.kind === Kind.OBJECT_TYPE_DEFINITION || definition.kind === Kind.OBJECT_TYPE_EXTENSION) &&
        definition.interfaces?.some((reference) => reference.name.value === "Node")
      ) {
        implementing.push(definition);
      }
    }

    for (const definition of implementing) {
      anySubgraphImplementsNode = true;
      const typeName = definition.name?.value ?? "?";
      const fields = (definition as { fields?: readonly FieldDefinitionNode[] }).fields;
      const idField = fields?.find((field) => field.name.value === "id");

      if (RESERVED_TYPE_NAMES.has(typeName)) {
        add("reserved-name", typeName, `${typeName} implements Node but uses a reserved type name.`);
      }
      if (!idField || !isNonNullId(idField.type)) {
        add("id-field", typeName, "a type that implements Node must have a field `id: ID!`.");
      }
      if (!definition.directives?.some(isResolvableIdKey)) {
        add(
          "resolvable-key",
          typeName,
          'a type that implements Node needs a resolvable `@key(fields: "id")` in this subgraph, so the router can fetch it by id.',
        );
      }
    }

    if (implementing.length > 0 && !entityInterfaceDeclared) {
      const names = implementing.map((definition) => definition.name?.value).join(", ");
      add(
        "entity-interface",
        names,
        'this subgraph has types that implement Node but does not declare `interface Node @key(fields: "id")`. ' +
          "Without it the router cannot ask this subgraph whether a bare id is one of its entities, so node(id) would not find them.",
      );
    }
  }

  if (anySubgraphImplementsNode && !interfaceObjectSeen) {
    violations.push({
      rule: "node/missing-interface-object",
      message:
        'no subgraph serves Query.node: one subgraph must declare `type Node @key(fields: "id") @interfaceObject { id: ID! }`.',
    });
  }
  return violations;
}
