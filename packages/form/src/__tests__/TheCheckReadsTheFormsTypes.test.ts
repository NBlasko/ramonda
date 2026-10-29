import { analyzeProject } from "@ramonda/check";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "check-fixture");
const lineOf = (label: string) =>
  readFileSync(join(fixture, "app.tsx"), "utf8")
    .split("\n")
    .findIndex((line) => line.includes(`aria-label="${label}"`)) + 1;

/**
 * `ramonda-check` reads this package's own declarations, through core's, with no DOM lib: a stand-in
 * for each name the DOM lib declares — see `domStub` in `@ramonda/check`. Here, on
 * the built types and a schema of each kind, it tells a number and a day from text, and names the
 * control each one is missing.
 */
test("the check reads a number, a day and text off the form's real types", () => {
  const found = analyzeProject(join(fixture, "tsconfig.json")).findings["form-value-in-the-wrong-control"] ?? [];

  expect(found.map((issue) => [issue.line, issue.kind])).toEqual([
    [lineOf("age as text"), "number"],
    [lineOf("born as text"), "day"],
    [lineOf("name on a slider"), "text"],
    [lineOf("age, its type left off or number"), "number"],
  ]);
});
