/**
 * A spread base's classes without its SOURCE MARKS — the `r:src:<path>:<line>` classes a development
 * build adds to every block, naming where it was written.
 *
 * Called by emitted code, development only: `...$(base)` becomes `_unsrc(base)` when marks are on, so
 * the block that spreads names itself and its base does not. What an element shows is where each of
 * its blocks was USED. A build without marks never calls it.
 */
export function withoutSourceMarks<T extends string | false | null | undefined>(classes: T): T {
  // A part that is not there — an optional prop spread — is the merge's to skip, as it always was.
  if (typeof classes !== "string" || !classes.includes("r:src:")) return classes;
  return classes
    .split(" ")
    .filter((one) => !one.startsWith("r:src:"))
    .join(" ") as T;
}
