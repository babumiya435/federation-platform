/**
 * Asks the subgraph that owns an entity whether it has it, by id.
 *
 * Federation subgraphs answer `_entities` with `null` for an id they do not know. Two places
 * need that answer without going through the router: the node subgraph (is this id real?) and
 * the reviews subgraph (does this product exist?). See docs/decisions/0004 and 0009.
 */

export interface EntityCheck {
  /** The owner's GraphQL endpoint. */
  ownerUrl: string;
  typeName: string;
  /** The entity's global id, which is its federation key. */
  id: string;
  /** Forwarded so one request id spans the whole call chain. */
  requestId?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2000;

const EXISTS_QUERY = `query EntityExists($representations: [_Any!]!) {
  _entities(representations: $representations) { __typename }
}`;

/**
 * True if the owner has the entity, false if it answered `null` for it.
 *
 * Anything else (HTTP error, GraphQL error, timeout, unreachable) throws. Reporting "not
 * found" for an owner that is down would be a lie, so callers must decide what an outage means.
 */
export async function entityExists(check: EntityCheck): Promise<boolean> {
  const fetchImpl = check.fetchImpl ?? fetch;
  const response = await fetchImpl(check.ownerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(check.requestId ? { "x-request-id": check.requestId } : {}),
    },
    body: JSON.stringify({
      query: EXISTS_QUERY,
      variables: { representations: [{ __typename: check.typeName, id: check.id }] },
    }),
    signal: AbortSignal.timeout(check.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Owner of ${check.typeName} (${check.ownerUrl}) answered HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    data?: { _entities?: (unknown | null)[] };
    errors?: { message: string }[];
  };
  if (body.errors?.length) {
    throw new Error(`Owner of ${check.typeName} (${check.ownerUrl}) failed: ${body.errors[0]?.message}`);
  }
  return Boolean(body.data?._entities?.[0]);
}
