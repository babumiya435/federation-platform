#!/usr/bin/env node
// Mints a signed JWT for the local stack using the dev private key in auth/.
//
//   node scripts/mint-token.mjs --sub alice --scope "catalog:read:internal reviews:read:pii"
//   node scripts/mint-token.mjs --sub bob                 # valid token, no scopes
//   node scripts/mint-token.mjs --sub old --expires-in=-3600  # expired an hour ago
//     (use "=" for negative values; the router allows 60s of clock leeway)
//
// Prints only the token on stdout so it can be used as:
//   curl -H "authorization: Bearer $(node scripts/mint-token.mjs --sub alice)" ...
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    sub: { type: "string", default: "dev-user" },
    scope: { type: "string", default: "" },
    "expires-in": { type: "string", default: "3600" },
  },
});

const privateJwk = JSON.parse(
  readFileSync(fileURLToPath(new URL("../auth/dev-private-key.jwk.json", import.meta.url)), "utf8"),
);
const { kid, alg, use: _use, ...keyMaterial } = privateJwk;
const key = createPrivateKey({ key: keyMaterial, format: "jwk" });

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const nowSeconds = Math.floor(Date.now() / 1000);
const expiresIn = Number(values["expires-in"]);
if (!Number.isFinite(expiresIn)) {
  console.error("--expires-in must be a number of seconds");
  process.exit(1);
}

const header = { alg, typ: "JWT", kid };
const claims = {
  sub: values.sub,
  iat: nowSeconds,
  exp: nowSeconds + expiresIn,
  ...(values.scope ? { scope: values.scope } : {}),
};

const signingInput = `${base64url(header)}.${base64url(claims)}`;
const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
console.log(`${signingInput}.${signature.toString("base64url")}`);
