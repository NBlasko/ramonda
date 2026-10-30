import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "form-needs");
const found = () =>
  analyzeProject(join(fixture, "tsconfig.json")).findings["form-field-without-what-the-form-needs"] ?? [];
const source = readFileSync(join(fixture, "app.tsx"), "utf8").split("\n");
/** The line of the n-th occurrence of `text`, 1-based. */
const lineOf = (text: string, nth = 1) => {
  let seen = 0;
  return source.findIndex((line) => line.includes(text) && ++seen === nth) + 1;
};

/**
 * A field inside a `@ramonda/form` form carries every attribute the form needs — in the render that
 * holds the form, in a component rendered there, as children of a component that places them in its
 * form, and through a wrapper's props, checked where the wrapper is used.
 */
describe("a field inside a @ramonda/form form", () => {
  test("each shape is reported, and named", () => {
    const issues = found().map((issue) => [issue.line, issue.kind, issue.detail]);
    expect(issues).toEqual(
      expect.arrayContaining([
        [lineOf('aria-label="no blur"'), "missing", "`onblur`"],
        // An `onblur` that holds nothing, through a `const`, is no `onblur`.
        [lineOf('aria-label="blur as a const"') - 1, "missing", "`onblur`"],
        [lineOf('aria-label="select without invalid"'), "missing", "`aria-invalid`"],
        [lineOf('aria-label="child field"'), "missing", "`name`"],
        [lineOf('aria-label="shelled"'), "missing", "`name`, `onblur`, `aria-invalid`"],
        [lineOf("<StyledInput", 3), "not-passed", "onblur"],
        [lineOf("<Outer value"), "not-passed", "onblur"],
        [lineOf("attrs={{ oninput: undefined }}"), "bag-overrides", "attrs.oninput"],
        [lineOf("attrs={bag}"), "bag-unreadable", "attrs"],
        [lineOf("<Fancy"), "unreadable-component", "Fancy"],
        [lineOf("<Ambient"), "unreadable-component", "Ambient"],
        [lineOf('aria-label="unread box in form"'), "missing", "`name`, `onblur`, `aria-invalid`"],
        // `checked` beside a `value`: a pick, whose `onchange` is its handler — as the other rules read it.
        [lineOf('aria-label="unread radio in form"'), "missing", "`name`, `onblur`, `aria-invalid`"],
        // `checked={undefined}` is no `checked`: a text field, with its `value` and its own `oninput`.
        [lineOf('aria-label="checked as nothing"'), "missing", "`name`, `onblur`, `aria-invalid`"],
        // A `const` that holds nothing is nothing too: a text field, whose handler is `oninput`.
        [lineOf('aria-label="checked as a const"'), "missing", "`name`, `oninput`, `onblur`, `aria-invalid`"],
        [lineOf('aria-label="braced box"'), "missing", "`name`, `onblur`, `aria-invalid`"],
        [lineOf('attrs={{ value: "fixed" }}'), "bag-without-a-handler", "attrs"],
        [lineOf("<BoxInput attrs={{ checked: true }} />"), "bag-without-a-handler", "attrs"],
        [lineOf('attrs={{ value: "x", onchange: this.type }}'), "bag-without-a-handler", "attrs"],
        [lineOf("attrs={bag}", 2), "bag-unreadable", "attrs"],
        [lineOf("attrs={{ oninput }}"), "bag-overrides", "attrs.oninput"],
        // A `value` that holds nothing overrides the field's, and sets no model that needs a handler.
        [lineOf("attrs={{ value: undefined }}"), "bag-overrides", "attrs.value"],
        // A handler key that holds nothing carries no handler; one written as nothing on the field is none.
        [lineOf('attrs={{ value: "carried nothing"'), "bag-without-a-handler", "attrs"],
        [lineOf('<NoHandlerInput attrs={{ value: "x" }} />'), "bag-without-a-handler", "attrs"],
        [lineOf("class Detached"), "form-not-attached", "form"],
        [lineOf("class SignupForm"), "form-in-a-hook", "form"],
        [lineOf("class DetachedSignup"), "form-not-attached", "signup"],
        [lineOf("<TwoFields attrs={bag} />"), "bag-unreadable", "attrs"],
      ]),
    );
    expect(issues).toHaveLength(28);
  });

  test("a complete field, a wrapper handed everything, a harmless bag, a field outside a form and an app's own Form are silent", () => {
    const lines = new Set(found().map((issue) => issue.line));
    for (const line of [
      lineOf('aria-label="complete"'),
      lineOf('aria-label="complete box"'),
      lineOf('aria-label="value as a const"'),
      lineOf('aria-label="nothing, then onchange"') - 1,
      lineOf("<StyledInput", 2),
      lineOf('attrs={{ placeholder: "you@example.com" }}'),
      lineOf('aria-label="loose"'),
      lineOf("<StyledInput value={value} oninput={this.type} />"),
      lineOf('attrs={{ value: "x", oninput: this.type }}'),
      lineOf('<HandledInput oninput={this.type} attrs={{ value: "x" }} />'),
      lineOf("<EarlySpread"),
      lineOf('<BoxInput attrs={{ value: "yes" }} />'),
      lineOf('aria-label="hidden const in form"'),
      lineOf('"on:input": this.type'),
      lineOf('aria-label="own form field"'),
      lineOf("class OwnForm"),
    ]) {
      expect(lines.has(line), String(line)).toBe(false);
    }
  });
});
