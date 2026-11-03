#!/usr/bin/env node
// Rate-limit cases against a running stack (docker compose up). Exits non-zero on failure.
//   ROUTER_URL=http://localhost:4000/graphql node scripts/rate-limit-cases.mjs
//
// Limits under test (from the product subgraph's @rateLimit directives):
//   Query.products     5 per 10s
//   Mutation.addReview 2 per 10s
//   Product.reviews   20 per 10s
// Every case uses its own caller (JWT subject) so cases cannot disturb each other. The
// anonymous case shares one address bucket with anything else run anonymously, so the
// script first waits for the window to pass.
import { setTimeout as sleep } from "node:timers/promises";
import { createChecks, globalId, post, tokenFor } from "./lib/stack.mjs";

const WINDOW_SECONDS = 10;

const send = (query, sub) => post(query, sub ? tokenFor(sub) : undefined);

const PRODUCTS = "{ products(first: 1) { edges { node { name } } } }";
const isLimited = (result) => result.status === 429 && result.body.errors?.[0]?.extensions?.code === "RATE_LIMITED";
const isServed = (result) => result.status === 200 && !result.body.errors;

const { expect, finish } = createChecks();

console.log(`waiting ${WINDOW_SECONDS + 1}s so earlier anonymous traffic has left its window...`);
await sleep((WINDOW_SECONDS + 1) * 1000);

// 1. allowed and rejected calls, and what a rejection looks like
{
  const results = [];
  for (let call = 1; call <= 6; call++) results.push(await send(PRODUCTS, "rl-basic"));
  expect("calls up to the limit are served", results.slice(0, 5).every(isServed), results.slice(0, 5));
  const rejected = results[5];
  expect("the call over the limit is rejected with HTTP 429", isLimited(rejected), rejected);
  const extensions = rejected.body.errors?.[0]?.extensions ?? {};
  expect(
    "the rejection says which field, the limit, the window and when to retry",
    extensions.field === "Query.products" &&
      extensions.limit === 5 &&
      extensions.windowSeconds === WINDOW_SECONDS &&
      extensions.retryAfterSeconds >= 1 &&
      extensions.retryAfterSeconds <= WINDOW_SECONDS &&
      rejected.body.data === undefined,
    rejected.body,
  );
}

// 2. two callers are kept apart
{
  for (let call = 1; call <= 5; call++) await send(PRODUCTS, "rl-alice");
  const aliceOver = await send(PRODUCTS, "rl-alice");
  const bobFirst = await send(PRODUCTS, "rl-bob");
  expect("a caller who used up the limit is rejected", isLimited(aliceOver), aliceOver);
  expect("a different caller is unaffected", isServed(bobFirst), bobFirst);
}

// 3. an anonymous caller is limited too, by address, and does not affect token holders
{
  const results = [];
  for (let call = 1; call <= 6; call++) results.push(await send(PRODUCTS));
  expect("anonymous calls up to the limit are served", results.slice(0, 5).every(isServed), results.slice(0, 5));
  expect("the anonymous call over the limit is rejected", isLimited(results[5]), results[5]);
  const tokenHolder = await send(PRODUCTS, "rl-not-anonymous");
  expect("an authenticated caller has its own counter", isServed(tokenHolder), tokenHolder);
}

// 4. one request with several limited fields
{
  // aliases and repeats each count, so six uses of a limit-5 field can never succeed
  const sixAliases = `{ ${[1, 2, 3, 4, 5, 6].map((n) => `a${n}: products(first: 1) { edges { node { name } } }`).join(" ")} }`;
  const tooMany = await send(sixAliases, "rl-aliases");
  expect(
    "six aliases of a limit-5 field are rejected outright",
    isLimited(tooMany) && /more than the 5 allowed/.test(tooMany.body.errors[0].message),
    tooMany.body,
  );
  const afterwards = await send(PRODUCTS, "rl-aliases");
  expect("a rejected request is not charged: the caller still has its full limit", isServed(afterwards), afterwards);

  // fields reached through a named fragment are counted: a fragment holding six aliases
  // is as over-limit as six aliases written inline
  const fragmentWithAliases = `fragment P on Query { ${[1, 2, 3, 4, 5, 6].map((n) => `f${n}: products(first: 1) { edges { node { name } } }`).join(" ")} }
    { ...P }`;
  const fragmentResult = await send(fragmentWithAliases, "rl-fragments");
  expect("fields reached through a named fragment are counted", isLimited(fragmentResult), fragmentResult);

  // identical fields (same response key) are merged by GraphQL before the router calls
  // the plugin: one execution, so one unit. Five such requests must all be served.
  const mergedTwice = "{ products(first: 1) { edges { node { name } } } products(first: 1) { edges { node { name } } } }";
  const mergedResults = [];
  for (let call = 1; call <= 5; call++) mergedResults.push(await send(mergedTwice, "rl-merged"));
  expect("a field written twice with the same key is merged and counts once", mergedResults.every(isServed), mergedResults);

  // two limited fields, one of them exhausted: the whole request is refused and the
  // other field is not charged either
  const productId = globalId("Product", "trail-backpack");
  const reviewsOnly = `{ node(id: "${productId}") { ... on Product { reviews { rating } } } }`;
  const both = "{ products(first: 1) { edges { node { reviews { rating } } } } }";
  for (let call = 1; call <= 5; call++) await send(PRODUCTS, "rl-multi");
  const refused = await send(both, "rl-multi");
  expect(
    "a request with several limited fields is refused as a whole when one is over",
    isLimited(refused) && refused.body.errors.length === 1 && refused.body.errors[0].extensions.field === "Query.products",
    refused.body,
  );
  const reviewResults = [];
  for (let call = 1; call <= 20; call++) reviewResults.push(await send(reviewsOnly, "rl-multi"));
  expect(
    "the other field was not charged by the refused request (all 20 of its units remain)",
    reviewResults.every(isServed),
    reviewResults.filter((result) => !isServed(result)).slice(0, 1),
  );
  const reviewsOver = await send(reviewsOnly, "rl-multi");
  expect("and Product.reviews has its own limit of 20", isLimited(reviewsOver), reviewsOver);

  // a request that fits both limits is served and charges both
  const fits = await send(both, "rl-multi-fresh");
  expect("a request using two limited fields within both limits is served", isServed(fits), fits);
}

// 5. rejected work never reaches a subgraph: a refused mutation must not run
{
  const campStove = globalId("Product", "camp-stove");
  const countReviews = async () => {
    const result = await send(`{ node(id: "${campStove}") { ... on Product { reviews { id } } } }`, "rl-observer");
    return result.body.data?.node?.reviews?.length;
  };
  const addReview = (sub) =>
    send(
      `mutation { addReview(input: { productId: "${campStove}", rating: 5, body: "rate limit probe", authorEmail: "probe@example.com" }) { __typename } }`,
      sub,
    );

  const before = await countReviews();
  const first = await addReview("rl-writer");
  const second = await addReview("rl-writer");
  const third = await addReview("rl-writer");
  const after = await countReviews();

  expect("the first two mutations run", isServed(first) && isServed(second), [first, second]);
  expect("the third mutation is rejected", isLimited(third), third);
  expect(
    "the rejected mutation never reached the subgraph (only two reviews were added)",
    typeof before === "number" && after === before + 2,
    { before, after },
  );
}

// 6. recovery once the window has passed
{
  for (let call = 1; call <= 5; call++) await send(PRODUCTS, "rl-recover");
  const blocked = await send(PRODUCTS, "rl-recover");
  expect("before the window passes the caller is still rejected", isLimited(blocked), blocked);

  const waitSeconds = (blocked.body.errors?.[0]?.extensions?.retryAfterSeconds ?? WINDOW_SECONDS) + 1;
  console.log(`waiting ${waitSeconds}s (retryAfterSeconds + 1)...`);
  await sleep(waitSeconds * 1000);

  const recovered = await send(PRODUCTS, "rl-recover");
  expect("after the window has passed the caller is served again", isServed(recovered), recovered);
}

finish("all rate-limit cases passed");
