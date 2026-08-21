import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "host-nesting", "tsconfig.json"));
const found = () => run().findings["tag-needs-its-parent"];

/**
 * A tag inside a COMPONENT, and what the walk can prove about the parent.
 *
 * `tag-needs-its-parent` stopped at every component, and the reason was right for most of them:
 * what `<Layout>` renders is decided inside `Layout`, and it may well be the `<table>` this row
 * needs. It was wrong for the commonest shape there is — a wrapper whose `render()` hands
 * `this.props.children` straight back, so the HOST element is their parent and nothing of the
 * component's own is in between.
 *
 * The host tag is read from `@Host`, through a NAME as well as written out. A tag CALLBACK is
 * computed from props and has no single answer, so the walk stops there exactly as it used to.
 */
describe("a tag inside a component's host", () => {
  test("a wrapper whose host is the wrong parent is reported", () => {
    // Line 60 is `<Box><tr /></Box>` with `@Host("div")`; line 72 is a plain `<div>` in the same
    // render, which is the control the fixture is measured against.
    expect(found().map((issue) => `${issue.line} <${issue.tag}> in <${issue.found}>`)).toEqual([
      "60 <tr> in <div>",
      "72 <tr> in <div>",
    ]);
  });

  /**
   * `@Host("table")` written out, and `@Host(TABLE)` one name away. Both are the parent the row
   * needs, so both are silent — and the second is the shape that made the question worth asking.
   */
  test("a host that IS the parent the tag needs is silent, written or named", () => {
    const lines = found().map((issue) => issue.line);

    expect(lines).not.toContain(52);
    expect(lines).not.toContain(56);
  });

  /**
   * Two silences that must stay. A component that renders a `<table>` of its own puts the children
   * inside THAT, not inside its host — so the host says nothing about them. And a tag computed from
   * props has no single answer at all.
   */
  test("a component that wraps its children, and a computed tag, are both left alone", () => {
    const lines = found().map((issue) => issue.line);

    expect(lines).not.toContain(64);
    expect(lines).not.toContain(68);
  });
});
