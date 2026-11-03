import { describe, expect, it } from "vitest";
import { RATE_LIMIT_SPEC_URL, rateLimitDirective, rateLimitSchemaOptions } from "./index.js";

describe("the @rateLimit declaration", () => {
  it("has the arguments the router plugin reads, with cost defaulting to 1", () => {
    expect(rateLimitDirective.name).toBe("rateLimit");
    expect(rateLimitDirective.locations).toEqual(["FIELD_DEFINITION"]);
    const args = Object.fromEntries(rateLimitDirective.args.map((argument) => [argument.name, String(argument.type)]));
    expect(args).toEqual({ limit: "Int!", windowSeconds: "Int!", cost: "Int!" });
    expect(rateLimitDirective.args.find((argument) => argument.name === "cost")?.defaultValue).toBe(1);
  });

  it("links the spec and composes the directive, which is what keeps it in the supergraph", () => {
    expect(rateLimitSchemaOptions.composeDirectives).toEqual(["@rateLimit"]);
    expect(rateLimitSchemaOptions.schemaDirectives.link).toEqual({ url: RATE_LIMIT_SPEC_URL, import: ["@rateLimit"] });
    expect(rateLimitSchemaOptions.directives).toEqual([rateLimitDirective]);
  });
});
