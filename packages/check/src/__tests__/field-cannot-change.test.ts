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
 * A controlled field the page cannot change. Core answers every edit in the field's own listener and
 * shows the model, so a controlled field without a handler of its own that writes the model cannot be
 * changed at all — whatever is around it, wherever its value comes from.
 */
describe("a field the user cannot change", () => {
  test("each shape is reported, and named", () => {
    expect(found().map((issue) => [issue.line, issue.component, issue.kind])).toEqual([
      [lineOf('aria-label="optional handler"'), "TextArea", "handler-may-be-missing"],
      [lineOf('aria-label="held select"'), "Select", "no-handler"],
      [lineOf('aria-label="held text"'), "TextArea", "no-handler"],
      [lineOf('aria-label="from props"'), "TextArea", "no-handler"],
      [lineOf('aria-label="a list row"'), "TextArea", "no-handler"],
      [lineOf('aria-label="a namespaced row from props"'), "TextArea", "no-handler"],
      [lineOf('aria-label="keydown only"'), "TextArea", "no-handler"],
      [lineOf('aria-label="maybe read only"'), "TextArea", "no-handler"],
      [lineOf('aria-label="held input"'), "input", "no-handler"],
      [lineOf('aria-label="held box"'), "input", "no-handler"],
      [lineOf('aria-label="readonly box"'), "input", "no-handler"],
      [lineOf('aria-label="readonly select"'), "Select", "no-handler"],
      [lineOf('aria-label="saved on blur"'), "TextArea", "held-between-keystrokes"],
      [lineOf('aria-label="input saved on blur"'), "input", "held-between-keystrokes"],
      [lineOf('aria-label="both"'), "TextArea", "both"],
      [lineOf('aria-label="both boxes"'), "input", "both"],
      [lineOf('aria-label="literal value"'), "TextArea", "literal"],
      [lineOf('aria-label="literal through a const"'), "TextArea", "literal"],
      [lineOf('aria-label="negative literal input"'), "input", "literal"],
      [lineOf('aria-label="unknown spread"'), "TextArea", "unknown-spread"],
      [lineOf('aria-label="unknown spread without a value"'), "input", "unknown-spread"],
      [lineOf('aria-label="an app\'s own constraints"'), "input", "unknown-spread"],
      [lineOf('aria-label="constraints and no handler"'), "input", "no-handler"],
      [lineOf('aria-label="own field spread"'), "input", "unknown-spread"],
      [lineOf('aria-label="a spread and a default"'), "input", "unknown-spread"],
      [lineOf('aria-label="a handler written as nothing"'), "input", "no-handler"],
      // A `const` that holds nothing is nothing, as a literal is: no handler; and below, no model.
      [lineOf('aria-label="a handler held as nothing"'), "input", "no-handler"],
      [lineOf('aria-label="a box picked by click"'), "input", "pick-through-click"],
      [lineOf('aria-label="a date on change"'), "input", "change-after-its-input"],
      [lineOf('aria-label="a box of a type unread"'), "input", "no-handler"],
      // `checked` beside a `value`: the value is what the box sends, and `checked` its model.
      [lineOf('aria-label="a radio of a type unread, held"'), "input", "no-handler"],
      [lineOf('aria-label="a box through a const"'), "input", "no-handler"],
      // A multi-line element is reported at its opening, the line above its `type`.
      [lineOf("type={withTime") - 1, "input", "change-after-its-input"],
    ]);
  });

  /**
   * A handler of its own, a field binding, a default, a field that takes no edit, and one with no
   * model as written are all silent.
   */
  test("a handler on the field, a binding, a default and a field that takes no edit are silent", () => {
    const lines = new Set(found().map((issue) => issue.line));
    for (const label of [
      "required handler",
      "picked",
      "picked on input",
      "typed",
      "typed input",
      "ticked",
      "radio picked",
      "constraints",
      "props spread",
      "typed colon",
      "default",
      "namespaced default",
      "default input",
      "default box",
      "read only",
      "read only string",
      "locked const",
      "read only input",
      "disabled",
      "hidden",
      "submit",
      "hidden with a spread",
      "null value",
      "undefined value",
      "action menu",
    ]) {
      expect(lines.has(lineOf(`aria-label="${label}"`)), label).toBe(false);
    }
  });

  /**
   * The answer the advice gives, `defaultValue`, must not be reported by another rule. Core's
   * `Select` and `TextArea` stand for their tags, and an `<input>` takes it as where it starts.
   */
  test("defaultValue and defaultChecked are reported by no rule", () => {
    const all = analyzeProject(join(here, "fixtures", "field-cannot-change", "tsconfig.json")).findings;
    for (const label of ["default", "namespaced default", "default input", "default box"]) {
      const line = lineOf(`aria-label="${label}"`);
      const reported = Object.entries(all)
        .filter(([, issues]) => (issues as { line?: number }[]).some((issue) => issue.line === line))
        .map(([rule]) => rule);
      expect(reported, label).toEqual([]);
    }
  });
});
