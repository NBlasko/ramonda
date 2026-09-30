import { describe, expect, test } from "vitest";
import { openedFor } from "../compiler/openGrammar";
import { resolving } from "../compiler/classify";
import { parseValueSyntax } from "../compiler/valueSyntax";

/**
 * Opening a shorthand's grammar until every leaf belongs to a longhand.
 *
 * A family's published grammar does not name its longhands. `<single-animation>` is written in
 * types, and `animation-name` appears nowhere in it — so before a value can be parsed against the
 * grammar, each part of the grammar has to be told which longhand it feeds. Where a part cannot
 * say, it is OPENED into its own grammar and the question asked again.
 *
 * That rule is the generator's already: it is how a flat slot list reaches the parts of
 * `<single-animation>`. What is here is the same rule keeping the TREE, because a parse needs the
 * order and the shape and a flat list has neither.
 */

/** A tiny grammar table for named types, standing in for `mdn.css.syntaxes`. */
const grammars = (rows: Record<string, string>) => (name: string) => rows[name] ?? "";

/** A tiny property table, read through references the way the build reads it. */
const properties = (rows: Record<string, string>) => resolving((name: string) => rows[name] ?? "");

const open = (source: string, longhands: readonly string[], rows: Record<string, string> = {}) =>
  openedFor(parseValueSyntax(source), longhands, grammars(rows), properties(rows));

/** Each leaf as `what=longhands`, in the order the grammar names them. */
const leaves = (source: string, longhands: readonly string[], rows: Record<string, string> = {}) => {
  const opened = open(source, longhands, rows);
  if (opened === undefined) return undefined;
  return opened.leaves.map((one) => `${one.term.name ?? one.term.kind}=${one.longhands.join("+")}`);
};

describe("a part that already belongs to a longhand", () => {
  test("stays as it is", () => {
    const rows = { "a-width": "<length>", "a-style": "<line-style>" };

    expect(leaves("<length> <line-style>", ["a-width", "a-style"], rows)).toEqual([
      "length=a-width",
      "line-style=a-style",
    ]);
  });

  test("and the order is the grammar's, because a parse depends on it", () => {
    const rows = { "a-style": "<line-style>", "a-width": "<length>" };

    expect(leaves("<line-style> <length>", ["a-width", "a-style"], rows)).toEqual([
      "line-style=a-style",
      "length=a-width",
    ]);
  });
});

describe("a part that belongs to nothing", () => {
  /**
   * `<single-animation>` is the case this exists for: no longhand's grammar mentions it, and inside
   * it every component does belong to one.
   */
  test("is opened into its own grammar and asked again", () => {
    const rows = { "one-item": "<length> <line-style>", "a-width": "<length>", "a-style": "<line-style>" };

    expect(leaves("<one-item>", ["a-width", "a-style"], rows)).toEqual(["length=a-width", "line-style=a-style"]);
  });

  test("and a part that cannot be opened means the family has no shape here", () => {
    expect(leaves("<mystery>", ["a-width"], { "a-width": "<length>" })).toBeUndefined();
  });
});

/**
 * A LITERAL is kept, which is the whole difference from the flat reading.
 *
 * `componentsOf` drops a literal, because a slot list has nowhere to put one. A parse does:
 * `mask`'s `<bg-position> [ / <bg-size> ]?` is two longhands told apart by the slash, and without
 * it `center / cover` and `center cover` are the same value.
 */
describe("a separator", () => {
  test("is kept, because a parse reads it", () => {
    const rows = { "a-pos": "<position>", "a-size": "<length>" };
    const opened = open("<position> / <length>", ["a-pos", "a-size"], rows);

    expect(opened?.tree.terms?.map((one) => one.name ?? one.kind)).toEqual(["position", "/", "length"]);
  });

  test("and it belongs to no longhand", () => {
    const rows = { "a-pos": "<position>", "a-size": "<length>" };

    expect(leaves("<position> / <length>", ["a-pos", "a-size"], rows)).toEqual(["position=a-pos", "length=a-size"]);
  });
});

/**
 * A GROUP that claims a longhand keeps its shape, and every leaf in it carries the claim.
 *
 * `[ none | <custom-ident> ]` is `animation-name`'s part of `<single-animation>`. As one slot it is
 * one entry; as a tree it is two leaves, and both feed the same longhand. Carrying the claim down
 * is what stops the group being opened into a grammar it does not have.
 */
describe("a group that claims a longhand", () => {
  /**
   * The branch that claims NOTHING on its own is what makes this a rule rather than a shortcut.
   *
   * `a-name` is written `none`, so `<custom-ident>` asked by itself claims no longhand and has no
   * grammar to be opened into — alone it refuses the whole family. The group claims the longhand
   * because one of its branches does, and carrying that down is what keeps the other branch.
   * Written this way after the first version passed with the carrying REMOVED: both branches
   * answered for themselves, so the test could not see the rule it was named for.
   */
  test("even a branch that claims nothing on its own", () => {
    const rows = { "a-name": "none" };

    expect(leaves("[ none | <custom-ident> ]", ["a-name"], rows)).toEqual(["none=a-name", "custom-ident=a-name"]);
  });

  test("and the group is still a group, not a leaf", () => {
    const rows = { "a-name": "none | <custom-ident>" };
    const opened = open("[ none | <custom-ident> ] <length>", ["a-name", "a-len"], { ...rows, "a-len": "<length>" });

    expect(opened?.tree.terms?.[0]?.kind).toBe("alt");
  });
});

/**
 * A leaf's OWN claim comes before one carried down from its group.
 *
 * A group of alternatives claims the union of what its branches claim, and carrying that down to
 * every leaf made each branch feed every longhand the group could reach. Found by review: in
 * `timeline-trigger` all five leaves came out claiming `timeline-trigger-name`, so the name, the
 * source and the ranges overwrote each other and `--t auto normal` set the name to `normal`.
 * Measured in Chromium, the only engine that has the property, and the author's `--t` was lost.
 *
 * The carried claim exists for a branch that claims NOTHING on its own; it must not replace a
 * claim the branch does have.
 */
describe("a branch that claims its own longhand", () => {
  test("keeps it, rather than taking the whole group's", () => {
    const rows = { "a-width": "<length>", "a-style": "<line-style>" };

    expect(leaves("[ <length> | <line-style> ]", ["a-width", "a-style"], rows)).toEqual([
      "length=a-width",
      "line-style=a-style",
    ]);
  });
});

/**
 * A claim is carried down only to the ALTERNATIVES of a group, never through a sequence.
 *
 * `[ none | <custom-ident> ]` is two ways of writing one component, so a branch that claims
 * nothing may take the group's longhand. A SEQUENCE inside a group is different components written
 * one after another, and carrying the claim through it gave `timeline-trigger`'s two range leaves
 * the NAME — so `--t auto normal` set the name to `normal`. Found by review, measured in Chromium.
 */
describe("a sequence inside a group of alternatives", () => {
  test("does not hand its components the group's longhand", () => {
    const rows = { "a-name": "none | <dashed-ident>" };

    expect(leaves("[ none | <dashed-ident> <mystery> ]", ["a-name"], rows)).toBeUndefined();
  });

  test("while a direct alternative still takes it", () => {
    expect(leaves("[ none | <custom-ident> ]", ["a-name"], { "a-name": "none" })).toEqual([
      "none=a-name",
      "custom-ident=a-name",
    ]);
  });
});

describe("what it refuses", () => {
  test("a grammar that would open for ever", () => {
    expect(leaves("<loop>", ["a-width"], { loop: "<loop>", "a-width": "<length>" })).toBeUndefined();
  });

  test("a family whose grammar claims nothing at all", () => {
    expect(leaves("<position>", ["a-width"], { "a-width": "<length>" })).toBeUndefined();
  });

  /**
   * A grammar with nothing in it but separators. There is a tree, and nothing to split BY — every
   * value would map to no longhand, which is not a split but a silent loss.
   */
  test("a grammar that is only a separator", () => {
    expect(leaves("/", ["a-width"], { "a-width": "<length>" })).toBeUndefined();
  });

  /**
   * But a separator BESIDE a real part is not that, and refusing it would be wrong: `4px /` maps
   * its one token perfectly well. A guard inside the group was written for this, was measured to
   * decide nothing a single-member group can reach — `[ / ]` collapses to the literal itself — and
   * would have refused the family where it did fire. Removed rather than kept.
   */
  test("but a separator beside a real part is fine", () => {
    expect(leaves("<length> [ / ]", ["a-width"], { "a-width": "<length>" })).toEqual(["length=a-width"]);
  });
});
