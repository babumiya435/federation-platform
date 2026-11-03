import { GraphQLError, Kind, parse, validate, type DocumentNode, type GraphQLSchema } from "graphql";
import type { Violation } from "./report.js";
import type { SourceFile } from "./repo.js";

/** Name of the operation or fragment that contains a source line, for friendlier messages. */
function definitionAt(document: DocumentNode, line: number): string | undefined {
  for (const definition of document.definitions) {
    if (!definition.loc) continue;
    if (line < definition.loc.startToken.line || line > definition.loc.endToken.line) continue;
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      return `${definition.operation} ${definition.name?.value ?? "(anonymous)"}`;
    }
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      return `fragment ${definition.name.value}`;
    }
  }
  return undefined;
}

function violationFor(file: SourceFile, document: DocumentNode, error: GraphQLError, rule: string): Violation {
  const position = error.locations?.[0];
  const context = position ? definitionAt(document, position.line) : undefined;
  return {
    rule,
    location: position ? `${file.path}:${position.line}:${position.column}` : file.path,
    message: context ? `${error.message} (in ${context})` : error.message,
  };
}

/** Validates every operation file against the schema; one violation per problem found. */
export function validateOperations(
  schema: GraphQLSchema,
  files: readonly SourceFile[],
  rule: string,
): Violation[] {
  return files.flatMap((file) => {
    try {
      const document = parse(file.content);
      return validate(schema, document).map((error) => violationFor(file, document, error, rule));
    } catch (error) {
      if (error instanceof GraphQLError) {
        // A file that does not even parse is reported against the file, not skipped.
        const position = error.locations?.[0];
        return [
          {
            rule,
            location: position ? `${file.path}:${position.line}:${position.column}` : file.path,
            message: `Syntax error: ${error.message}`,
          },
        ];
      }
      throw error;
    }
  });
}
