import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const OPERATIONS_DIR = "clients/operations";

export interface SourceFile {
  path: string;
  content: string;
}

export function readRepoFile(relativePath: string): string {
  return readFileSync(`${repoRoot}${relativePath}`, "utf8");
}

/** Every `subgraphs/<name>/schema.graphql` that exists, sorted by subgraph name. */
export function loadSubgraphSdls(): { name: string; sdl: string }[] {
  return readdirSync(`${repoRoot}subgraphs`, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        return [{ name: entry.name, sdl: readRepoFile(`subgraphs/${entry.name}/schema.graphql`) }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function loadOperationFiles(): SourceFile[] {
  try {
    return readdirSync(`${repoRoot}${OPERATIONS_DIR}`)
      .filter((file) => file.endsWith(".graphql"))
      .sort()
      .map((file) => ({
        path: `${OPERATIONS_DIR}/${file}`,
        content: readRepoFile(`${OPERATIONS_DIR}/${file}`),
      }));
  } catch {
    return [];
  }
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export class BaseRefError extends Error {}

/** `origin/main`, falling back to a local `main`, unless the caller names a ref. */
export function resolveBaseRef(requested: string | undefined): { ref: string; sha: string } {
  const candidates = requested ? [requested] : ["origin/main", "main"];
  for (const ref of candidates) {
    try {
      return { ref, sha: git(["rev-parse", "--short", `${ref}^{commit}`]).trim() };
    } catch {
      // try the next candidate
    }
  }
  throw new BaseRefError(
    `Could not find the base ref (${candidates.join(", ")}). ` +
      "Fetch it (CI needs fetch-depth: 0) or name one with --base <ref> or GOVERNANCE_BASE_REF.",
  );
}

/** The client operations as committed at `ref`; empty if the folder does not exist there. */
export function loadOperationFilesAtRef(ref: string): SourceFile[] {
  const listed = git(["ls-tree", "-r", "--name-only", ref, "--", OPERATIONS_DIR]).trim();
  if (!listed) {
    return [];
  }
  return listed
    .split("\n")
    .filter((path) => path.endsWith(".graphql"))
    .map((path) => ({ path, content: git(["show", `${ref}:${path}`]) }));
}
