import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "transform-pure");
const found = () => analyzeProject(join(fixture, "tsconfig.json")).findings["transform-that-is-not-pure"] ?? [];
const lineOf = (label: string) =>
  readFileSync(join(fixture, "app.tsx"), "utf8")
    .split("\n")
    .findIndex((line) => line.includes(label)) + 1;

/**
 * A `transform` is a pure function this can read — followed into other files, into the helpers it
 * calls, and into the function a factory made once at the top of a module.
 */
describe("a transform that is not pure", () => {
  test("each shape is reported, and named", () => {
    expect(found().map((issue) => [issue.line, issue.kind])).toEqual([
      [lineOf('aria-label="reads this"'), "impure"],
      [lineOf('aria-label="logs"'), "impure"],
      [lineOf('aria-label="counts"'), "impure"],
      [lineOf('aria-label="clock"'), "impure"],
      [lineOf('aria-label="network"'), "impure"],
      [lineOf('aria-label="blocked set"'), "impure"],
      [lineOf('aria-label="plain config"'), "impure"],
      [lineOf('aria-label="loose factory"'), "impure"],
      [lineOf('aria-label="via helper"'), "impure"],
      [lineOf('aria-label="hands on"'), "impure"],
      [lineOf('aria-label="marks input"'), "impure"],
      [lineOf('aria-label="from a package"'), "unreadable"],
      [lineOf('aria-label="from props"'), "unreadable"],
      [lineOf('aria-label="made in render"'), "built-in-render"],
      [lineOf('aria-label="uncontrolled"'), "uncontrolled"],
    ]);
  });

  test("it says why", () => {
    const why = new Map(found().map((issue) => [issue.line, issue.detail]));
    expect(why.get(lineOf('aria-label="reads this"'))).toBe("it reads `this`");
    expect(why.get(lineOf('aria-label="counts"'))).toContain("calls");
    expect(why.get(lineOf('aria-label="clock"'))).toContain("Date.now");
    expect(why.get(lineOf('aria-label="network"'))).toContain("fetch");
  });

  test("a method, an imported function and its helper, a factory's function, an arrow and an SVG transform are silent", () => {
    const lines = new Set(found().map((issue) => issue.line));
    for (const label of ["method", "imported", "factory const", "rebinds", "frozen", "arrow", "select"]) {
      expect(lines.has(lineOf(`aria-label="${label}"`)), label).toBe(false);
    }
    expect(lines.has(lineOf("<g transform"))).toBe(false);
  });
});
