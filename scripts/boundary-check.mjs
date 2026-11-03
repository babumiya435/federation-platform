#!/usr/bin/env node
// Proves the graph really is split across subgraphs: one query that starts in the product
// subgraph, continues in the reviews subgraph (Product.reviews) and comes back to the product
// subgraph (Review.product). The evidence is the router's own log of which subgraphs it called.
// Reads `docker compose logs`, so run it from the repository with the stack started.
//   ROUTER_URL=http://localhost:4000/graphql node scripts/boundary-check.mjs
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createChecks, globalId, post, tokenFor } from "./lib/stack.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const { expect, finish } = createChecks();

const routerLogLines = () =>
  execFileSync("docker", ["compose", "logs", "--no-log-prefix", "router"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.includes('"target":"router::request"'))
    .map((line) => JSON.parse(line.slice(line.indexOf("{"))));

/** Sends a query under a unique operation name and returns the router's log line for it. */
async function sendAndFindInLog(query, operationName, token) {
  const result = await post(query.replace("OPERATION", operationName), token);
  let logLine;
  for (let attempt = 0; attempt < 8 && !logLine; attempt++) {
    await sleep(500);
    logLine = routerLogLines().find((line) => line.operation_name === operationName);
  }
  return { result, logLine };
}

const suffix = Math.random().toString(36).slice(2, 8);
const token = tokenFor(`boundary-${suffix}`);
const subgraphsCalled = (logLine) => String(logLine?.involved_subgraphs ?? "").split(",").filter(Boolean).sort();

// 1. products -> reviews -> product, in one query
{
  const { result, logLine } = await sendAndFindInLog(
    "query OPERATION { products(first: 1) { edges { node { name reviews { rating product { name } } } } } }",
    `BoundaryA${suffix}`,
    token,
  );
  const node = result.body.data?.products?.edges?.[0]?.node;
  expect("Product.reviews comes from the reviews subgraph and Review.product comes back to the product subgraph", node?.name === "Trail Backpack" && node.reviews?.length === 2 && node.reviews.every((review) => review.product?.name === "Trail Backpack"), result.body);
  expect("the router called both subgraphs for it", JSON.stringify(subgraphsCalled(logLine)) === JSON.stringify(["product", "reviews"]), logLine);
  expect("and it went product, reviews, product: three subgraph requests", logLine?.subgraph_requests === 3, logLine);
}

// 2. a Review fetched by id alone, with its product across the boundary
{
  const reviewId = globalId("Review", "insulated-bottle-review-1");
  const { result, logLine } = await sendAndFindInLog(
    `query OPERATION { node(id: "${reviewId}") { ... on Review { rating product { name price } } } }`,
    `BoundaryB${suffix}`,
    token,
  );
  const node = result.body.data?.node;
  expect("node(id) for a Review resolves the Review and its Product across the boundary", node?.rating === 4 && node.product?.name === "Insulated Bottle", result.body);
  expect("the router called the reviews subgraph (owner) and the product subgraph (reference)", subgraphsCalled(logLine).includes("product") && subgraphsCalled(logLine).includes("reviews"), logLine);
}

// 3. the mutation lives in the reviews subgraph but checks the product with the product subgraph
{
  const campStove = globalId("Product", "camp-stove");
  const { result, logLine } = await sendAndFindInLog(
    `mutation OPERATION { addReview(input: { productId: "${campStove}", rating: 5, body: "boundary check", authorEmail: "boundary@example.com" }) { __typename ... on AddReviewSuccess { review { product { name } } } } }`,
    `BoundaryC${suffix}`,
    token,
  );
  expect("addReview succeeds and its product reference resolves", result.body.data?.addReview?.review?.product?.name === "Camp Stove", result.body);
  expect("the router called reviews for the mutation and product for the reference", subgraphsCalled(logLine).join() === "product,reviews", logLine);
}

finish("subgraph boundary checks passed");
