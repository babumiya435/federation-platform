/**
 * Global ids: base64url("<TypeName>:<localId>").
 *
 * The id is opaque to clients but not secret or signed. It is also the federation
 * key (`@key(fields: "id")`) of every Node type, so any subgraph can refer to an
 * entity it does not own with just `{ __typename, id }`. See
 * docs/decisions/0002-global-ids.md.
 */

export interface DecodedGlobalId {
  typeName: string;
  localId: string;
}

const TYPE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function encodeGlobalId(typeName: string, localId: string): string {
  if (!TYPE_NAME.test(typeName)) {
    throw new Error(`Invalid type name for global id: ${typeName}`);
  }
  if (localId.length === 0) {
    throw new Error("Global id local part must not be empty");
  }
  return Buffer.from(`${typeName}:${localId}`, "utf8").toString("base64url");
}

/** Returns null for anything that is not a well-formed global id. */
export function decodeGlobalId(id: string): DecodedGlobalId | null {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    return null;
  }
  const decoded = Buffer.from(id, "base64url").toString("utf8");
  // Reject ids that do not round-trip (non-canonical base64 or invalid UTF-8).
  if (Buffer.from(decoded, "utf8").toString("base64url") !== id) {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator <= 0) {
    return null;
  }
  const typeName = decoded.slice(0, separator);
  const localId = decoded.slice(separator + 1);
  if (!TYPE_NAME.test(typeName) || localId.length === 0) {
    return null;
  }
  return { typeName, localId };
}
