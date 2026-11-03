// Helpers shared by the scripts that talk to a running stack (smoke, rate-limit cases).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const routerUrl = process.env.ROUTER_URL ?? "http://localhost:4000/graphql";
const mintScript = fileURLToPath(new URL("../mint-token.mjs", import.meta.url));

/** Mints a dev token; arguments are passed to scripts/mint-token.mjs. */
export const mint = (...args) => execFileSync("node", [mintScript, ...args], { encoding: "utf8" }).trim();
export const tokenFor = (sub) => mint("--sub", sub);

export const globalId = (typeName, localId) =>
  Buffer.from(`${typeName}:${localId}`).toString("base64url");

/** POSTs a GraphQL query to the router, optionally with a bearer token. */
export async function post(query, token) {
  const response = await fetch(routerUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query }),
  });
  return { status: response.status, body: await response.json() };
}

/** Collects pass/fail lines; `finish` prints a summary and sets the exit code. */
export function createChecks() {
  const failures = [];
  return {
    expect(name, condition, detail) {
      console.log(`${condition ? "ok  " : "FAIL"} ${name}`);
      if (!condition) failures.push(`${name}: ${JSON.stringify(detail)}`);
    },
    finish(successMessage) {
      if (failures.length > 0) {
        console.error(`\n${failures.length} check(s) failed:\n${failures.join("\n")}`);
        process.exit(1);
      }
      console.log(`\n${successMessage}`);
    },
  };
}
