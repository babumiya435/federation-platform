/**
 * How a subgraph declares `@rateLimit`, in one place, so every subgraph that uses it declares
 * it identically. The router's plugin enforces it (docs/decisions/0006-rate-limits.md).
 *
 * Composition silently drops a custom directive unless the subgraph both links its spec and
 * lists it in `@composeDirective`; spreading `rateLimitSchemaOptions` into
 * `builder.toSubGraphSchema` does both.
 */
import { DirectiveLocation, GraphQLDirective, GraphQLInt, GraphQLNonNull } from "graphql";

export const RATE_LIMIT_SPEC_URL = "https://platform.local/rate-limit/v1.0";

export const rateLimitDirective = new GraphQLDirective({
  name: "rateLimit",
  locations: [DirectiveLocation.FIELD_DEFINITION],
  args: {
    limit: { type: new GraphQLNonNull(GraphQLInt) },
    windowSeconds: { type: new GraphQLNonNull(GraphQLInt) },
    cost: { type: new GraphQLNonNull(GraphQLInt), defaultValue: 1 },
  },
});

/** Spread into `builder.toSubGraphSchema({ ... })`. */
export const rateLimitSchemaOptions = {
  composeDirectives: ["@rateLimit"] as `@${string}`[],
  schemaDirectives: { link: { url: RATE_LIMIT_SPEC_URL, import: ["@rateLimit"] } },
  directives: [rateLimitDirective],
};

/** For the Pothos builder's `Directives` type parameter (a type alias: Pothos needs the index signature). */
export type RateLimitDirectiveTypes = {
  rateLimit: {
    locations: "FIELD_DEFINITION";
    args: { limit: number; windowSeconds: number; cost?: number };
  };
};
