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
        // A handler key that holds nothing carries no handler; one written as nothing on the field is none.
        [lineOf('attrs={{ value: "carried nothing"'), "bag-without-a-handler", "attrs"],
        [lineOf('<NoHandlerInput attrs={{ value: "x" }} />'), "bag-without-a-handler", "attrs"],
        [lineOf('<NoHandlerInput attrs={{ value: "y", oninput: this.type }} />'), "bag-without-a-handler", "attrs"],
        [lineOf('<Toggle type="checkbox" attrs={{ checked: on }} />'), "bag-without-a-handler", "attrs"],
        [
          lineOf('<Toggle type="text" attrs={{ value: "v", onchange: this.type }} />'),
          "bag-without-a-handler",
          "attrs",
        ],
        [lineOf("class Detached"), "form-not-attached", "form"],
        [lineOf("class SignupForm"), "form-in-a-hook", "form"],
        [lineOf("class SignupThroughABase"), "form-in-a-hook", "form"],
        [lineOf("class DetachedSignup"), "form-not-attached", "signup"],
        [lineOf("class TwoForms"), "form-not-attached", "login"],
        // A field inside the holder's own form: every use hands its prop, inside a form or not.
        [lineOf("<NamedByAProp />"), "not-passed", "n"],
        // A component rendering with the render it inherits: the field there is inside the form.
        [lineOf('aria-label="inherited render"'), "missing", "`name`, `oninput`, `onblur`, `aria-invalid`"],
        // A class a `const` holds is read as the class it is.
        [lineOf('aria-label="class in a const"'), "missing", "`name`, `onblur`, `aria-invalid`"],
        // A form a base class holds, attached by the class extending it.
        [lineOf('aria-label="in a form held by a base"'), "missing", "`name`, `onblur`, `aria-invalid`"],
        // A render a package declares cannot be read; one a `const` holds can.
        [lineOf("<MyField />"), "unreadable-component", "MyField"],
        [lineOf('aria-label="const base"'), "missing", "`name`, `onblur`, `aria-invalid`"],
        [lineOf('<AriaInput name="a"'), "not-passed", "aria-invalid"],
        [lineOf("<StyledByAProp />"), "not-passed", "n"],
        [lineOf("<SpreadInItsForm value"), "not-passed", "name"],
        [lineOf("<SpreadInItsForm value"), "not-passed", "onblur"],
        [lineOf("<SpreadInItsForm value"), "not-passed", "invalid"],
        // In a callback with a body, inside the form all the same.
        [lineOf('aria-label="in a block body"'), "missing", "`name`, `oninput`, `onblur`, `aria-invalid`"],
        // A form held in a private field.
        [lineOf('aria-label="in a private form"'), "missing", "`name`, `oninput`, `onblur`, `aria-invalid`"],
        [lineOf("class PrivateDetached"), "form-not-attached", "#form"],
        // A union spread may hand what any of its members hands.
        [lineOf("<BareInput {...either} />"), "bag-unreadable", "attrs"],
        [lineOf("<BareInput {...this.props.extra} />"), "bag-unreadable", "attrs"],
        [lineOf("<BareInput {...anObject} />"), "bag-unreadable", "attrs"],
        [lineOf("<BareInput {...anything} />"), "bag-unreadable", "attrs"],
        [lineOf('attrs={{ "on:input": undefined }}'), "bag-overrides", "attrs.on:input"],
        [lineOf("<TwoFields attrs={bag} />"), "bag-unreadable", "attrs"],
        [lineOf("<BareInput {...rest} />"), "bag-unreadable", "attrs"],
        // A spread hands no prop for sure: its type does not say what it copies (a getter is not copied).
        ...["name", "value", "oninput", "onblur", "invalid"].map((detail) => [
          lineOf("<StyledInput {...handed} />"),
          "not-passed",
          detail,
        ]),
        // Nor one its type may leave out.
        [lineOf("<StyledInput {...partial}"), "not-passed", "name"],
        [lineOf("<StyledInput {...partial}"), "not-passed", "onblur"],
        [lineOf("<StyledInput {...partial}"), "not-passed", "invalid"],
        // `{...this.props}` hands on what the wrapper's own uses hand: asked there.
        [lineOf("<SpreadOuter value"), "not-passed", "name"],
        [lineOf("<SpreadOuter value"), "not-passed", "onblur"],
        [lineOf("<SpreadOuter value"), "not-passed", "invalid"],
        [lineOf("<SpreadBare attrs={bag} />"), "bag-unreadable", "attrs"],
      ]),
    );
    expect(issues).toHaveLength(65);
  });

  test("a base reached as `module.Base` lends its render", () => {
    const inBases = found().filter((issue) => issue.file.endsWith("bases.tsx"));
    expect(inBases.map((issue) => [issue.kind, issue.detail])).toEqual([
      ["missing", "`name`, `onblur`, `aria-invalid`"],
    ]);
  });

  test("a complete field, a wrapper handed everything, a harmless bag, a field outside a form and an app's own Form are silent", () => {
    const lines = new Set(found().map((issue) => issue.line));
    for (const line of [
      lineOf('aria-label="complete"'),
      lineOf('aria-label="complete box"'),
      lineOf('aria-label="value as a const"'),
      lineOf('aria-label="nothing, then onchange"') - 1,
      lineOf("<StyledInput", 2),
      lineOf('<SpreadOuter name="s"'),
      lineOf('<NamedByAProp n="handed" />'),
      // A key set to nothing that the field never writes takes nothing away, and sets no model that needs
      // a handler: the bare input writes nothing before its spread.
      lineOf("<BareInput attrs={{ value: undefined }} />"),
      lineOf("attrs={undefined} />"),
      lineOf("<TrackedInput"),
      lineOf("<BareInput {...hinted} />"),
      lineOf("class BaseHolder"),
      lineOf('<BareInput {...(on ? { title: "t" } : {})} />'),
      lineOf('<Toggle type="checkbox" attrs={{ checked: on, onchange: this.type }} />'),
      lineOf("attrs={NONE} />"),
      lineOf("keys the field never writes, set to nothing") + 1,
      lineOf('<SpreadBare attrs={{ placeholder: "spread" }} />'),
      lineOf("<StyledInput {...this.props} />"),
      lineOf("<BareInput {...this.props} />"),
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
