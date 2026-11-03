import { describe, expect, it } from "vitest";
import { decodeGlobalId, encodeGlobalId, localIdFor } from "./index.js";

describe("global id", () => {
  it("round-trips a type name and local id", () => {
    const id = encodeGlobalId("Product", "p-1");
    expect(decodeGlobalId(id)).toEqual({ typeName: "Product", localId: "p-1" });
  });

  it("keeps colons inside the local id", () => {
    const id = encodeGlobalId("Review", "a:b:c");
    expect(decodeGlobalId(id)).toEqual({ typeName: "Review", localId: "a:b:c" });
  });

  it("is url safe", () => {
    expect(encodeGlobalId("Product", "???>>>")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    "",
    "not base64!",
    "!!!!",
    Buffer.from("no-separator").toString("base64url"),
    Buffer.from(":missing-type").toString("base64url"),
    Buffer.from("Product:").toString("base64url"),
    Buffer.from("1Bad:x").toString("base64url"),
    Buffer.from("Product:xy").toString("base64"), // padded, non-canonical
  ])("returns null for malformed id %j", (id) => {
    expect(decodeGlobalId(id)).toBeNull();
  });

  it("refuses to encode an invalid type name or empty local id", () => {
    expect(() => encodeGlobalId("bad name", "x")).toThrow();
    expect(() => encodeGlobalId("Product", "")).toThrow();
  });

  it("localIdFor returns the local part only for the right type", () => {
    expect(localIdFor("Product", encodeGlobalId("Product", "p-1"))).toBe("p-1");
    expect(localIdFor("Product", encodeGlobalId("Review", "p-1"))).toBeNull();
    expect(localIdFor("Product", "###")).toBeNull();
    expect(localIdFor("Product", "")).toBeNull();
  });
});
