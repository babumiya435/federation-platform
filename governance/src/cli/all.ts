import { spawnSync } from "node:child_process";
import { repoRoot } from "../repo.js";

/**
 * Runs every governance check, one after another, and does not stop at the first
 * failure: each check prints its own result, and the summary says which ones failed.
 * CI runs the same checks as separate jobs so each shows up as its own status.
 */
const checks: { name: string; command: string[] }[] = [
  { name: "composition", command: ["--filter", "@federation-platform/governance", "run", "check:composition"] },
  { name: "node-rules", command: ["--filter", "@federation-platform/node", "run", "sync:check"] },
  { name: "operations", command: ["--filter", "@federation-platform/governance", "run", "check:operations"] },
  { name: "breaking-changes", command: ["--filter", "@federation-platform/governance", "run", "check:breaking"] },
  { name: "policy", command: ["--filter", "@federation-platform/governance", "run", "check:policy"] },
  { name: "decisions", command: ["--filter", "@federation-platform/governance", "run", "check:decisions"] },
];

const results = checks.map(({ name, command }) => {
  console.log(`\n--- ${name} ---`);
  const result = spawnSync("pnpm", command, { cwd: repoRoot, stdio: ["ignore", "inherit", "inherit"] });
  return { name, passed: result.status === 0 };
});

console.log("\nGovernance summary");
for (const { name, passed } of results) {
  console.log(`  ${passed ? "pass" : "FAIL"}  ${name}`);
}
if (results.some((result) => !result.passed)) {
  process.exit(1);
}
