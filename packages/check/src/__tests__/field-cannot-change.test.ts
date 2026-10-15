import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "field-cannot-change", "tsconfig.json")).findings[
    "field-the-user-cannot-change"
  ] ?? [];
const lineOf = (label: string) =>
  readFileSync(join(here, "fixtures", "field-cannot-change", "app.tsx"), "utf8")
    .split("\n")
    .findIndex((line) => line.includes(label)) + 1;

/**
 * A `Select` or `TextArea` whose `value` nothing moves. Core settles a field with `value` from the
 * model after every input, so such a field undoes every input — the page cannot change it.
 */
describe("a field the user cannot change", () => {
  test("each shape is reported, and named", () => {
    expect(found().map((issue) => [issue.line, issue.component, issue.kind])).toEqual([
      [lineOf('aria-label="held select"'), "Select", "no-handler"],
      [lineOf('aria-label="held text"'), "TextArea", "no-handler"],
      [lineOf('aria-label="saved on blur"'), "TextArea", "held-between-keystrokes"],
      [lineOf('aria-label="both"'), "TextArea", "both"],
    ]);
  });

  /**
   * A handler in any spelling core answers, a `defaultValue` field, and a spread that may carry the
   * handler are silent — the last because `{...bind}` from `@ramonda/form` is how a form field is
   * written, and a rule that cannot see into it would report every one.
   */
  test("a handler, a defaultValue and a spread are silent", () => {
    const lines = new Set(found().map((issue) => issue.line));
    for (const label of ["picked", "picked on input", "typed", "typed camel", "typed colon", "default", "bound"]) {
      expect(lines.has(lineOf(`aria-label="${label}"`))).toBe(false);
    }
  });
});
