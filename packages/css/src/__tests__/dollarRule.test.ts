import { describe, expect, test } from "vitest";
import type { Config } from "../config";
import { readBlock } from "../compiler/read";
import { type Finding, checkBlock } from "../compiler/rules";
import { findBlocks } from "../compiler/scan";
import { kind } from "../declared";

/**
 * `$a.b.c` naming a variable the project never declared.
 *
 * **This is the rule that stops `$` being a quiet way to write a `var()` into nothing.** The
 * compiler emits `var(--a-b-c)` from the path alone and reads no config to do it — deliberately, so
 * the CLI, the bundler and the editor cannot disagree — which means a typo compiles to a name
 * nothing sets. Registered variables resolve to their initial value; an unregistered one resolves to
 * nothing and the property silently becomes something else. Measured: `height: var(--never-set)`
 * laid an element out at 0px with nothing reported anywhere.
 *
 * The types catch this in an editor. This is for everywhere else: CI, a pre-commit hook, a reviewer.
 */

const declared: Config = {
  variables: {
    $color: kind("color", { primary: { main: "#3b82f6", light: "#93c5fd" } }),
    $size: kind("length", { control: { md: "30px" } }),
  },
};

function check(css: string, config: Config | undefined): Finding[] {
  const source = `<div className={@@(\n${css}\n)}>x</div>`;
  const [site] = findBlocks(source);
  const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
  return checkBlock(read.block, { config });
}

const rules = (css: string, config: Config | undefined = declared) => check(css, config).map((one) => one.rule);
const messages = (css: string, config: Config | undefined = declared) => check(css, config).map((one) => one.message);

describe("a `$` path the project did not declare", () => {
  test("a declared path is silent, which is the case that must not regress", () => {
    expect(rules("color: $color.primary.main;")).toEqual([]);
    expect(rules("padding: $size.control.md;")).toEqual([]);
  });

  test("an undeclared path is reported, and a near miss is offered", () => {
    expect(rules("color: $color.primary.mian;")).toEqual(["unknown-variable"]);
    expect(messages("color: $color.primary.mian;")[0]).toContain("color.primary.main");
  });

  test("a path with nothing like it gets no invented suggestion", () => {
    expect(rules("color: $nothing.like.it;")).toEqual(["unknown-variable"]);
    expect(messages("color: $nothing.like.it;")[0]).not.toContain("Did you mean");
  });

  test("a GROUP is reported too, because a group is not a value", () => {
    expect(rules("color: $color.primary;")).toEqual(["unknown-variable"]);
    expect(messages("color: $color.primary;")[0]).toMatch(/group/i);
  });

  test("`$` with nothing after it is reported rather than compiled", () => {
    expect(rules("color: $;")).toEqual(["unknown-variable"]);
    expect(messages("color: $;")[0]).toContain("`$( … )`");
  });

  test("a project that declared NO variables is told so, not quietly allowed", () => {
    // The user's own instruction on defaults: a config that permits everything when it was never
    // set means people can do as they like without ever learning the config exists.
    expect(rules("color: $color.primary.main;", {})).toEqual(["unknown-variable"]);
    expect(messages("color: $color.primary.main;", {})[0]).toMatch(/declares no variables/i);
  });

  test("no config object at all is silence, because nothing was asked", () => {
    // `transform` may be called without one — by a test, or by a caller that does not want
    // config-aware checking. That is different from a config that declares nothing.
    expect(rules("color: $color.primary.main;", undefined)).toEqual([]);
  });

  test("the finding lands on the path, not on the declaration", () => {
    const source = `<div className={@@(\ncolor: $color.primary.mian;\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    const [found] = checkBlock(read.block, { config: declared });

    expect(source.slice(found.at, found.at + (found.length ?? 0))).toBe("$color.primary.mian");
  });
});

/**
 * A `$` whose GROUP the project does not have — the case most likely to be a reach for code.
 *
 * `$` and a name is only ever a theme variable, so `$theme.dark` or `$props.size` is somebody who
 * meant a value from TypeScript. The message names the groups that DO exist, and the door for code.
 */
describe("a `$` naming a group the project does not have", () => {
  test("names the groups there are, and `$( … )` for a value from code", () => {
    expect(rules("color: $props.tone;")).toEqual(["unknown-variable"]);
    const [message] = messages("color: $props.tone;");

    expect(message).toContain("`$color`");
    expect(message).toContain("`$size`");
    expect(message).toContain("`$( … )`");
  });

  test("a misspelt group is offered the nearest one", () => {
    expect(messages("color: $colr.primary.main;")[0]).toContain("`$color.primary.main`");
  });

  test("a known group with a wrong path is not told about code", () => {
    expect(messages("color: $color.primary.mian;")[0]).not.toContain("`$( … )`");
  });
});

/**
 * `var(--color-primary-main)` written by hand for a variable the project DECLARES.
 *
 * It renders the same, and it is the one spelling of a variable nothing checks: rename the variable
 * in `ramonda.css.ts` and this keeps reading the old name, which nothing sets. `$color.primary.main`
 * is checked against the config, so the message names it.
 */
describe("a declared variable read with a hand-written `var()`", () => {
  test("is reported, naming the spelling to write instead", () => {
    expect(rules("color: var(--color-primary-main);")).toEqual(["variable-by-hand"]);
    expect(messages("color: var(--color-primary-main);")[0]).toContain("`$color.primary.main`");
  });

  test("inside a longer value, on the `var()` itself", () => {
    const source = "<div className={@@(\nborder: 1px solid var(--color-primary-light);\n)}>x</div>";
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    const [found] = checkBlock(read.block, { config: declared });

    expect(source.slice(found.at, found.at + found.length)).toBe("var(--color-primary-light)");
  });

  test.each([
    ["a name the project does not declare", "color: var(--brand);"],
    ["one with a fallback, which `$` cannot say", "color: var(--color-primary-main, red);"],
    ["a group's name, which is no variable", "color: var(--color-primary);"],
    ["the `$` spelling itself", "color: $color.primary.main;"],
  ])("%s is left alone", (_what, css) => {
    expect(rules(css)).toEqual([]);
  });

  test("with no config, nothing is asked", () => {
    expect(check("color: var(--color-primary-main);", undefined)).toEqual([]);
  });
});
