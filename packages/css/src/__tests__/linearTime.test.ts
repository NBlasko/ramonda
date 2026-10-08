import { describe, expect, test } from "vitest";
import { importedSites } from "../compiler/references";
import { parseValueSyntax } from "../compiler/valueSyntax";
import { exclusive, widthSlot } from "../runtime/conditions";
import { rules } from "./rules/helpers";

/**
 * Text an author writes, read in LINEAR time.
 *
 * Every case is the input a ReDoS checker (`recheck`) produced for one pattern, grown to 40,000
 * characters — and every one of them was MEASURED slow before its fix: a pattern whose two parts can
 * both take the same character tries every way of sharing it. The compiler answers the editor on each
 * keystroke and the runtime answers on each render, so a quadratic pattern is a frozen editor or a
 * stalled page the day somebody pastes the wrong thing.
 *
 * The bound is generous on purpose — a slow CI machine must not fail it — and still a hundred times
 * below what each took: 1–3 s here, and one never finished.
 */
const N = 40_000;
const SPACES = " ".repeat(N);

const quickly = (run: () => unknown) => {
  const started = performance.now();
  try {
    run();
  } catch {
    // Refusing the input is an answer too; only the time is asked here.
  }
  return performance.now() - started;
};

describe("read in linear time", () => {
  test.each<[string, () => unknown]>([
    // `runtime/conditions.ts`: a feature's value between two runs of spaces.
    ["a media pair that never closes", () => exclusive([`@media (min-width:${SPACES}x`], ["@media (max-width: 1px)"])],
    // A range group: the text before and after the comparison both took a `<`.
    ["a range group of nothing but comparisons", () => widthSlot([`@media (${"<".repeat(N)}`])],
    // And the split around the comparison, spaces on either side of nothing.
    ["spaces before a comparison that is not there", () => widthSlot([`@media (width${SPACES}x < 40rem)`])],
    // `compiler/valueSyntax.ts`: spaces before a range that never comes.
    ["spaces inside a registered type", () => parseValueSyntax(`<length${SPACES}x>`)],
    // `compiler/references.ts`: spaces between two names with no `as`.
    [
      "spaces in an import with no `as`",
      () =>
        importedSites(`import { a${SPACES}b } from "./x";\n`, {
          filename: "/a.tsx",
          read: () => "export const a = @@keyframes(\n  from { opacity: 0; }\n);\n",
        }),
    ],
    // `compiler/rules/selectors.ts`: an attribute bracket that never closes.
    ["an attribute bracket that never closes", () => rules(`  &[a${"[".repeat(N)} { color: red; }`)],
  ])("%s", (_what, run) => {
    expect(quickly(run)).toBeLessThan(250);
  });
});
