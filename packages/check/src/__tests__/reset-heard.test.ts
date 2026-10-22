import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "reset-heard");
const found = () => analyzeProject(join(fixture, "tsconfig.json")).findings["reset-the-model-does-not-hear"] ?? [];
const lineOf = (text: string) =>
  readFileSync(join(fixture, "app.tsx"), "utf8")
    .split("\n")
    .findIndex((line) => line.includes(text)) + 1;

/**
 * The browser's reset tells no handler, so it is allowed only where no field with a `value` can be
 * reached — and the model's own `reset()` is always allowed.
 */
describe("a reset the model does not hear", () => {
  test("each shape is reported, and named", () => {
    expect(found().map((issue) => [issue.line, issue.kind])).toEqual([
      [lineOf("(event.currentTarget as HTMLFormElement).reset()"), "browser-reset"],
      [lineOf('aria-label="b"'), "controlled-field"],
      [lineOf('aria-label="capital box"'), "controlled-field"],
      [lineOf('aria-label="c"'), "controlled-field"],
      [lineOf("<Child />"), "unseen-content"],
      [lineOf("{this.props.children}"), "unseen-content"],
      [lineOf('aria-label="braced reset field"'), "controlled-field"],
      [lineOf('aria-label="unread reset field"'), "controlled-field"],
      [lineOf('aria-label="spread field"'), "unseen-content"],
      [lineOf('aria-label="braced box"'), "controlled-field"],
      [lineOf("{this.props.children ?? <p>None</p>}"), "unseen-content"],
      [lineOf('<form id="joined">'), "unseen-content"],
      [lineOf("{this.label}"), "unseen-content"],
      [lineOf("loose reset"), "no-form"],
      [lineOf('form="other"'), "elsewhere"],
    ]);
  });

  test("a form of uncontrolled fields, a declared reset and a hook's reset are silent", () => {
    const lines = new Set(found().map((issue) => issue.line));
    for (const text of [
      "ok reset",
      'value="Start over"',
      'name="csrf"',
      "this.counter.reset()",
      "this.form.reset()",
      "city.reset()",
    ]) {
      expect(lines.has(lineOf(text)), text).toBe(false);
    }
  });
});
