import {
  getNamedType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isIntrospectionType,
  isNonNullType,
  isObjectType,
  isUnionType,
  type GraphQLField,
  type GraphQLNamedType,
  type GraphQLObjectType,
  type GraphQLSchema,
} from "graphql";
import type { Violation } from "./report.js";

/**
 * Schema policy, applied to the API schema clients see. Rules and reasons:
 * docs/decisions/0007-schema-governance.md.
 */

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const CAMEL_CASE = /^[a-z][A-Za-z0-9]*$/;
const SCREAMING_SNAKE_CASE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

function mutationFields(schema: GraphQLSchema): [string, GraphQLField<unknown, unknown>][] {
  const root = schema.getMutationType();
  return root ? Object.entries(root.getFields()).map(([name, field]) => [`${root.name}.${name}`, field]) : [];
}

/** policy/mutation-result-union: a mutation returns a union of one success type and typed errors. */
function mutationResultUnions(schema: GraphQLSchema): Violation[] {
  return mutationFields(schema).flatMap(([coordinate, field]) => {
    const returned = getNamedType(field.type);
    const problem = (message: string): Violation[] => [
      { rule: "policy/mutation-result-union", location: coordinate, message },
    ];
    if (!isUnionType(returned)) {
      return problem(
        `returns ${returned.name}, which is not a union. Mutations return a result union ` +
          `(a success type plus typed errors), for example \`union ${field.name[0]?.toUpperCase()}${field.name.slice(1)}Result = ...\`.`,
      );
    }
    if (!returned.name.endsWith("Result")) {
      return problem(`returns union ${returned.name}; result unions are named \`<Something>Result\`.`);
    }
    const members = returned.getTypes().map((member) => member.name);
    const hasError = members.some((name) => name.endsWith("Error"));
    const hasSuccess = members.some((name) => !name.endsWith("Error"));
    if (!hasError || !hasSuccess) {
      return problem(
        `${returned.name} must contain a success type and at least one type named \`...Error\` (has: ${members.join(", ")}).`,
      );
    }
    return [];
  });
}

function checkConnection(connection: GraphQLObjectType, coordinate: string): Violation[] {
  const problems: string[] = [];
  const fields = connection.getFields();

  const edges = fields["edges"];
  const pageInfo = fields["pageInfo"];
  if (!edges) {
    problems.push(`${connection.name} has no \`edges\` field`);
  } else {
    const edgeType = getNamedType(edges.type);
    if (!isObjectType(edgeType)) {
      problems.push(`${connection.name}.edges must be a list of edge objects`);
    } else {
      const edgeFields = edgeType.getFields();
      if (!edgeFields["node"]) problems.push(`${edgeType.name} has no \`node\` field`);
      const cursor = edgeFields["cursor"];
      if (!cursor || !isNonNullType(cursor.type) || getNamedType(cursor.type).name !== "String") {
        problems.push(`${edgeType.name}.cursor must be \`String!\``);
      }
    }
  }
  if (!pageInfo || !isNonNullType(pageInfo.type) || getNamedType(pageInfo.type).name !== "PageInfo") {
    problems.push(`${connection.name}.pageInfo must be \`PageInfo!\``);
  }
  return problems.map((message) => ({ rule: "policy/relay-connection-shape", location: coordinate, message }));
}

/** policy/relay-connection-shape: anything named `...Connection` follows Relay's cursor connection spec. */
function relayConnectionShape(schema: GraphQLSchema): Violation[] {
  const violations: Violation[] = [];
  const seenConnections = new Set<string>();

  for (const type of Object.values(schema.getTypeMap())) {
    if (!isObjectType(type) || isIntrospectionType(type)) continue;
    for (const field of Object.values(type.getFields())) {
      const returned = getNamedType(field.type);
      if (!returned.name.endsWith("Connection") || !isObjectType(returned)) continue;
      const coordinate = `${type.name}.${field.name}`;

      const args = new Map(field.args.map((argument) => [argument.name, getNamedType(argument.type).name]));
      const forward = args.get("first") === "Int" && args.get("after") === "String";
      const backward = args.get("last") === "Int" && args.get("before") === "String";
      if (!forward && !backward) {
        violations.push({
          rule: "policy/relay-connection-shape",
          location: coordinate,
          message: `returns ${returned.name} but has no pagination arguments. Expected \`first: Int, after: String\` (forward) and/or \`last: Int, before: String\` (backward).`,
        });
      }
      if (!seenConnections.has(returned.name)) {
        seenConnections.add(returned.name);
        violations.push(...checkConnection(returned, coordinate));
      }
    }
  }
  return violations;
}

/** policy/naming-convention: PascalCase types, camelCase fields and arguments, SCREAMING_SNAKE_CASE enum values. */
function namingConvention(schema: GraphQLSchema): Violation[] {
  const violations: Violation[] = [];
  const add = (location: string, message: string) =>
    violations.push({ rule: "policy/naming-convention", location, message });

  const types: GraphQLNamedType[] = Object.values(schema.getTypeMap()).filter(
    (type) => !isIntrospectionType(type),
  );
  for (const type of types) {
    if (!PASCAL_CASE.test(type.name)) add(type.name, `type names are PascalCase`);
    if (isInputObjectType(type)) {
      if (!type.name.endsWith("Input")) add(type.name, `input types are named \`...Input\``);
      for (const field of Object.values(type.getFields())) {
        if (!CAMEL_CASE.test(field.name)) add(`${type.name}.${field.name}`, `input fields are camelCase`);
      }
    }
    if (isEnumType(type)) {
      for (const value of type.getValues()) {
        if (!SCREAMING_SNAKE_CASE.test(value.name)) {
          add(`${type.name}.${value.name}`, `enum values are SCREAMING_SNAKE_CASE`);
        }
      }
    }
    if (isObjectType(type) || isInterfaceType(type)) {
      for (const field of Object.values(type.getFields())) {
        if (!CAMEL_CASE.test(field.name)) add(`${type.name}.${field.name}`, `field names are camelCase`);
        for (const argument of field.args) {
          if (!CAMEL_CASE.test(argument.name)) {
            add(`${type.name}.${field.name}(${argument.name})`, `argument names are camelCase`);
          }
        }
      }
    }
  }
  return violations;
}

export function checkPolicy(schema: GraphQLSchema): Violation[] {
  return [...mutationResultUnions(schema), ...relayConnectionShape(schema), ...namingConvention(schema)];
}
