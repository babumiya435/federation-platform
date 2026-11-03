// Generates the DEV-ONLY signing key pair used by the local stack and CI.
// The keys are committed on purpose so `docker compose up` and CI work with no
// secrets. Never reuse them anywhere real.
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const kid = "dev-key-1";
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const authDir = fileURLToPath(new URL("../auth/", import.meta.url));

const publicJwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "ES256" };
const privateJwk = { ...privateKey.export({ format: "jwk" }), kid, use: "sig", alg: "ES256" };

writeFileSync(`${authDir}dev-jwks.json`, JSON.stringify({ keys: [publicJwk] }, null, 2) + "\n");
writeFileSync(`${authDir}dev-private-key.jwk.json`, JSON.stringify(privateJwk, null, 2) + "\n");
console.log(`wrote ${authDir}dev-jwks.json and dev-private-key.jwk.json (kid ${kid})`);
