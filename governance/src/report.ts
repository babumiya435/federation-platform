export interface Violation {
  /** Stable id, for example `policy/mutation-result-union`. */
  rule: string;
  message: string;
  /** `file:line:column` or a schema coordinate such as `Mutation.addReview`. */
  location?: string;
}

export function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map((violation) => {
      const where = violation.location ? `${violation.location}  ` : "";
      return `  [${violation.rule}] ${where}${violation.message}`;
    })
    .join("\n");
}

/** Prints the outcome of one check and exits non-zero if it found problems. */
export function finishCheck(title: string, violations: readonly Violation[], success: string): void {
  if (violations.length > 0) {
    const count = violations.length;
    console.error(`${title} failed with ${count} problem${count === 1 ? "" : "s"}:\n${formatViolations(violations)}`);
    process.exit(1);
  }
  console.log(`${title}: ${success}`);
}
