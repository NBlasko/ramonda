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
    // Line 61 is `<Box><tr /></Box>` with `@Host("div")`; line 73 is a plain `<div>` in the same
    // render, which is the control the fixture is measured against.
    expect(found().map((issue) => `${issue.line} <${issue.tag}> in <${issue.found}>`)).toEqual([
      "61 <tr> in <div>",
      "73 <tr> in <div>",
    ]);
  });

  /**
   * `@Host("table")` written out, and `@Host(TABLE)` one name away. Both are the parent the row
   * needs, so both are silent — and the second is the shape that made the question worth asking.
   */
  test("a host that IS the parent the tag needs is silent, written or named", () => {
    const lines = found().map((issue) => issue.line);

    expect(lines).not.toContain(53);
    expect(lines).not.toContain(57);
  });

  /**
   * Two silences that must stay. A component that renders a `<table>` of its own puts the children
   * inside THAT, not inside its host — so the host says nothing about them. And a tag computed from
   * props has no single answer at all.
   */
  test("a component that wraps its children, and a computed tag, are both left alone", () => {
    const lines = found().map((issue) => issue.line);

    expect(lines).not.toContain(65);
    expect(lines).not.toContain(69);
  });
});

/**
 * The `@Host` tag itself — three ways it is fine, and they are the whole set.
 *
 * `assertHostTag` in core refuses a malformed name, and it is `__DEV__`-only and fires when the
 * class is DEFINED — which for a component behind a route nobody opened is never, in the build that
 * ships. It also judges only the SHAPE of the name: `dvi` passes its pattern happily and renders an
 * unknown inline element that looks almost right.
 */
describe("a `@Host` tag that names no element", () => {
  const tags = () =>
    analyzeProject(join(here, "fixtures", "host-nesting", "tsconfig.json")).findings["host-tag-is-not-an-element"];

  test("a tag that is no element is reported, written or one name away", () => {
    expect(tags().map((issue) => `${issue.component}: ${issue.tag} (${issue.kind})`)).toEqual([
      "Typo: dvi (not an element)",
      // `@Host(TYPO)` where `const TYPO = "dvi"` — the same host, and the shape that made the
      // question worth asking in the first place.
      "NamedTypo: dvi (not an element)",
      // `2col` is not a name the DOM will take at all; core refuses it at runtime, in dev only.
      "NotAName: 2col (not a name)",
      // SVG is case-SENSITIVE: `clipPath` is the element and `clippath` is an unknown one.
      "Clipped: clippath (not an element)",
    ]);
  });

  /**
   * The prop at the CALL SITE is not followed into the callback, and that is the honest limit.
   *
   * `<FromProps as="dvi">` names no element, and `@Host((self) => self.props.as ?? "div")` is what
   * turns that prop into the tag. Reading it would mean following one value into one callback and
   * back out — and the answer would differ per call site, while this rule reports once per CLASS.
   * So the tag stays unknown and both rules stay quiet, which is the contract rather than an
   * oversight.
   */
  test("a tag the call site supplies through a prop is not read", () => {
    expect(tags().map((issue) => issue.component)).not.toContain("FromProps");
  });

  /** A dash is the standard's own marker for a custom element, and inventing one is the point. */
  test("a custom element, an SVG name and a computed tag are all left alone", () => {
    const named = tags().map((issue) => issue.component);

    expect(named).not.toContain("CustomElement");
    expect(named).not.toContain("Clip");
    // `@Host((self) => self.props.dense ? "table" : "div")` has no single answer, and core says the
    // same of it — it re-checks what the callback returns on every call instead.
    expect(named).not.toContain("Computed");
  });
});
