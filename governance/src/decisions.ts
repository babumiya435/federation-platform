import {
  Kind,
  parse,
  type ConstDirectiveNode,
  type FieldDefinitionNode,
  type InterfaceTypeDefinitionNode,
  type InterfaceTypeExtensionNode,
  type ObjectTypeDefinitionNode,
  type ObjectTypeExtensionNode,
} from "graphql";
import type { Violation } from "./report.js";

/**
 * Checks that enforce decisions we made earlier, so they hold without a reviewer
 * remembering them. ADR 0003 (`@requiresScopes`), ADR 0006 (`@rateLimit`).
 */

export interface SubgraphSdl {
  name: string;
  sdl: string;
}

const SCOPE_FORMAT = /^[a-z]+:[a-z]+:[a-z]+$/;
const MAX_WINDOW_SECONDS = 86_400;
const RATE_LIMIT_ARGUMENTS = ["limit", "windowSeconds", "cost"];

type ObjectLike = ObjectTypeDefinitionNode | ObjectTypeExtensionNode;
type InterfaceLike = InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode;

function hasDirective<T extends { name: { value: string } }>(directives: readonly T[] | undefined, name: string): T[] {
  return directives?.filter((directive) => directive.name.value === name) ?? [];
}

function integerArgument(directive: ConstDirectiveNode, name: string): number | undefined | "invalid" {
  const argument = directive.arguments?.find((candidate) => candidate.name.value === name);
  if (!argument) return undefined;
  return argument.value.kind === Kind.INT ? Number(argument.value.value) : "invalid";
}

/** Scopes from `@requiresScopes(scopes: [[...], [...]])`, one inner list per OR group. */
function scopeGroups(directive: ConstDirectiveNode): string[][] {
  const argument = directive.arguments?.find((candidate) => candidate.name.value === "scopes");
  if (argument?.value.kind !== Kind.LIST) return [];
  return argument.value.values.map((group) =>
    group.kind === Kind.LIST
      ? group.values.flatMap((scope) => (scope.kind === Kind.STRING ? [scope.value] : []))
      : [],
  );
}

function checkRequiresScopes(
  location: string,
  isQueryNode: boolean,
  directive: ConstDirectiveNode,
  vocabulary: ReadonlySet<string>,
  violations: Violation[],
): void {
  const add = (rule: string, message: string) => violations.push({ rule, location, message });

  if (isQueryNode) {
    add(
      "decisions/requires-scopes-placement",
      "@requiresScopes must not sit on Query.node. The node subgraph stays free of product policy; protect the fields on the owning type instead.",
    );
  }
  const groups = scopeGroups(directive);
  if (groups.length !== 1) {
    add(
      "decisions/requires-scopes-single-list",
      `@requiresScopes uses ${groups.length} scope lists. We use exactly one list (all scopes required); OR groups are not allowed until a use case needs them.`,
    );
  }
  for (const scope of groups.flat()) {
    if (!SCOPE_FORMAT.test(scope)) {
      add(
        "decisions/scope-vocabulary",
        `scope "${scope}" does not match <domain>:<action>:<sensitivity> (lower-case letters, colon separated).`,
      );
    } else if (!vocabulary.has(scope)) {
      add(
        "decisions/scope-vocabulary",
        `scope "${scope}" is not in governance/scopes.json. Add it there (with a description) in the same change.`,
      );
    }
  }
}

function checkRateLimitArguments(location: string, directive: ConstDirectiveNode, violations: Violation[]): void {
  const add = (message: string) => violations.push({ rule: "decisions/rate-limit-arguments", location, message });

  for (const argument of directive.arguments ?? []) {
    if (!RATE_LIMIT_ARGUMENTS.includes(argument.name.value)) {
      add(`@rateLimit has an unknown argument "${argument.name.value}" (allowed: ${RATE_LIMIT_ARGUMENTS.join(", ")}).`);
    }
  }
  const limit = integerArgument(directive, "limit");
  const windowSeconds = integerArgument(directive, "windowSeconds");
  const cost = integerArgument(directive, "cost");

  if (typeof limit !== "number" || limit < 1) add("@rateLimit `limit` must be an integer >= 1.");
  if (typeof windowSeconds !== "number" || windowSeconds < 1 || windowSeconds > MAX_WINDOW_SECONDS) {
    add(`@rateLimit \`windowSeconds\` must be an integer from 1 to ${MAX_WINDOW_SECONDS}.`);
  }
  if (cost !== undefined && (typeof cost !== "number" || cost < 1)) add("@rateLimit `cost` must be an integer >= 1.");
  if (typeof limit === "number" && typeof cost === "number" && cost > limit) {
    add(`@rateLimit \`cost\` (${cost}) is larger than \`limit\` (${limit}), so the field could never be called.`);
  }
}

export function checkDecisions(subgraphs: readonly SubgraphSdl[], scopeVocabulary: readonly string[]): Violation[] {
  const vocabulary = new Set(scopeVocabulary);
  const violations: Violation[] = [];

  const documents = subgraphs.map((subgraph) => ({ ...subgraph, document: parse(subgraph.sdl) }));

  // Field names declared by every interface in any subgraph, to spot fields that implement one.
  const interfaceFields = new Map<string, Set<string>>();
  for (const { document } of documents) {
    for (const definition of document.definitions) {
      if (definition.kind === Kind.INTERFACE_TYPE_DEFINITION || definition.kind === Kind.INTERFACE_TYPE_EXTENSION) {
        const names = interfaceFields.get(definition.name.value) ?? new Set<string>();
        for (const field of definition.fields ?? []) names.add(field.name.value);
        interfaceFields.set(definition.name.value, names);
      }
    }
  }

  for (const { name: subgraph, document } of documents) {
    for (const definition of document.definitions) {
      const isObject = definition.kind === Kind.OBJECT_TYPE_DEFINITION || definition.kind === Kind.OBJECT_TYPE_EXTENSION;
      const isInterface =
        definition.kind === Kind.INTERFACE_TYPE_DEFINITION || definition.kind === Kind.INTERFACE_TYPE_EXTENSION;
      const typeName = "name" in definition && definition.name ? definition.name.value : undefined;
      if (!typeName || !("directives" in definition)) continue;
      const where = (field?: FieldDefinitionNode) => `${subgraph}: ${typeName}${field ? `.${field.name.value}` : ""}`;

      // Directives on the type itself are never allowed for either decision.
      for (const directiveName of ["requiresScopes", "rateLimit"]) {
        if (hasDirective(definition.directives, directiveName).length > 0) {
          violations.push({
            rule: directiveName === "rateLimit" ? "decisions/rate-limit-placement" : "decisions/requires-scopes-placement",
            location: where(),
            message: `@${directiveName} goes on object-type fields, not on the type itself.`,
          });
        }
      }

      if (isInterface) {
        for (const field of (definition as InterfaceLike).fields ?? []) {
          if (hasDirective(field.directives, "requiresScopes").length > 0) {
            violations.push({
              rule: "decisions/requires-scopes-placement",
              location: where(field),
              message: "@requiresScopes is not allowed on interface fields (the router rejects it). Put it on the object type's field.",
            });
          }
          if (hasDirective(field.directives, "rateLimit").length > 0) {
            violations.push({
              rule: "decisions/rate-limit-placement",
              location: where(field),
              message: "@rateLimit is not allowed on interface fields. Put it on the object type's field.",
            });
          }
        }
      }

      if (isObject) {
        const implemented = ((definition as ObjectLike).interfaces ?? []).map((reference) => reference.name.value);
        for (const field of (definition as ObjectLike).fields ?? []) {
          for (const directive of hasDirective(field.directives, "requiresScopes")) {
            const isQueryNode = typeName === "Query" && field.name.value === "node";
            checkRequiresScopes(where(field), isQueryNode, directive, vocabulary, violations);
          }
          for (const directive of hasDirective(field.directives, "rateLimit")) {
            const implementsInterfaceField = implemented.some((interfaceName) =>
              interfaceFields.get(interfaceName)?.has(field.name.value),
            );
            if (implementsInterfaceField) {
              violations.push({
                rule: "decisions/rate-limit-placement",
                location: where(field),
                message:
                  "@rateLimit is not allowed on a field that implements an interface field: a client can select it through the interface and the gateway would not count it.",
              });
            }
            checkRateLimitArguments(where(field), directive, violations);
          }
        }
      }
    }
  }
  return violations;
}
