import { describe, expect, test } from "vitest";
import type { CssBlock, CssSpreadable } from "../properties";
import { mergeClassNames } from "../runtime/merge";

/**
 * WHAT THE BRAND STILL REFUSES, now that a block IS a string.
 *
 * The question a reader asks first: if `CssBlock` is `string & { … }`, has the brand stopped doing
 * anything? It has not, and each row below is a different way of arriving at a bare `string`.
 *
 * Asserted with `@ts-expect-error`, which **fails the build if a line ever stops being an error** —
 * so a refusal cannot quietly go away. `check.test.ts` asks the same question through a real
 * program, on the spread inside a block; this asks it of the types alone, where a cast and an `any`
 * live.
 */
declare const block: CssBlock;
declare const narrowed: CssBlock<{ color?: string }>;
declare const loose: string;
declare const anything: any;

describe("a block is not a string", () => {
  /**
   * The assertions are the `@ts-expect-error` lines, which `tsc` checks and vitest does not — so the
   * body is never RUN. Asserting that it exists is what keeps the file from being deleted as dead.
   */
  test("the refusals are asserted by `tsc`, on the lines below", () => {
    expect(typeof holds).toBe("function");
  });
});

function takesABlock(_one: CssBlock): void {}
function spreads<T>(_one: CssSpreadable<T>): void {}

function holds(): void {
  takesABlock(block);
  takesABlock(narrowed);

  // @ts-expect-error — a bare `string` is not a block
  takesABlock(loose);
  // @ts-expect-error — a string literal is not one either
  takesABlock("r-c-red");
  // @ts-expect-error — and neither is a union holding one
  takesABlock(Math.random() > 0.5 ? block : loose);

  /**
   * **Concatenation loses the brand**, which is what the old object shape could not even express:
   * two blocks joined with a template are a `string`, so the merge cannot be bypassed with `+`.
   */
  // @ts-expect-error — a template of two blocks is a string
  takesABlock(`${block} ${narrowed}`);

  /** And a SPREAD asks the same question, with a sentence instead of a type name. */
  spreads(block);
  // @ts-expect-error — only a style block can be spread
  spreads(loose);
  // @ts-expect-error — nor a hand-written object with the old shape
  spreads({ className: "r-c-red", properties: [], values: [] });

  /**
   * **A cast beats the type, and that is the honest limit.** `as` and `any` are the author saying
   * they know better; what stops those is the runtime, not this. Written down so the boundary is a
   * decision rather than a gap somebody finds later.
   */
  takesABlock(loose as CssBlock);
  takesABlock(anything);

  /** `mergeClassNames` is looser ON PURPOSE: `className` mixes ours with the author's own class names. */
  mergeClassNames("lead", block);
  mergeClassNames(block, false, null, undefined);
}
