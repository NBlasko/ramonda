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
      [lineOf('aria-label="a row of its own"'), "TextArea", "no-handler"],
      [lineOf('aria-label="a list row of its own"'), "Select", "no-handler"],
      [lineOf('aria-label="held select"'), "Select", "no-handler"],
      [lineOf('aria-label="held text"'), "TextArea", "no-handler"],
      [lineOf('aria-label="saved on blur"'), "TextArea", "held-between-keystrokes"],
      [lineOf('aria-label="both"'), "TextArea", "both"],
      [lineOf('aria-label="readonly select"'), "Select", "no-handler"],
      [lineOf('aria-label="literal value"'), "TextArea", "literal"],
      [lineOf('aria-label="negative literal value"'), "TextArea", "literal"],
      [lineOf('aria-label="literal through a const"'), "TextArea", "literal"],
      [lineOf('aria-label="spread on a wrapper"'), "TextArea", "no-handler"],
      [lineOf('aria-label="keyed by a prop"'), "TextArea", "no-handler"],
      [lineOf('aria-label="changed above"'), "TextArea", "no-handler"],
      [lineOf('aria-label="maybe read only"'), "TextArea", "no-handler"],
    ]);
  });

  /**
   * A handler in any spelling, a `defaultValue` field, a spread that may carry the handler (`{...bind}`
   * from `@ramonda/form`), a `readonly` or `disabled` field, and a field with a handler on an element
   * around it are all silent.
   */
  test("a handler, a defaultValue, a spread, a field that takes no input and one heard above are silent", () => {
    const lines = new Set(found().map((issue) => issue.line));
    for (const label of [
      "picked",
      "picked on input",
      "typed",
      "typed camel",
      "typed colon",
      "default",
      "bound",
      "read only",
      "disabled",
      "heard above",
      "spread above",
      "beforeinput editor",
      "inside a card",
      "action menu",
      "from props",
      "from props with a fallback",
      "from props destructured",
      "from props or empty",
      "from props on one arm",
      "from props through a call",
      "from props in a template",
      "from props through a method",
      "from a parameter",
      "from a destructured parameter",
      "from an array parameter",
      "past the bound",
      "a row from props",
      "a namespaced list row from props",
      "a row through Array.from",
      "a row of props in a literal",
      "a callback the rule cannot read",
      "from props at the head of a long sum",
      "from props through a local",
      "from props renamed through a local",
      "undefined default",
      "read only string",
      "locked const",
      "null value",
      "null value in parentheses",
      "undefined value",
    ]) {
      expect(lines.has(lineOf(`aria-label="${label}"`))).toBe(false);
    }
  });

  /**
   * The answer the advice gives, `defaultValue`, must not be reported by another rule. Core's
   * `Select` and `TextArea` stand for their tags, and `attribute-that-does-nothing` used to read the
   * prop as the dead DOM attribute — and rename it to `value`, which makes the field nobody can type in.
   */
  test("defaultValue on Select and TextArea is reported by no rule", () => {
    const all = analyzeProject(join(here, "fixtures", "field-cannot-change", "tsconfig.json")).findings;
    // Imported by name, and through a namespace: `ui.Select` is core's `Select` as well.
    for (const label of ["default", "namespaced default"]) {
      const line = lineOf(`aria-label="${label}"`);
      const reported = Object.entries(all)
        .filter(([, issues]) => (issues as { line?: number }[]).some((issue) => issue.line === line))
        .map(([rule]) => rule);
      expect(reported, label).toEqual([]);
    }
  });
});
