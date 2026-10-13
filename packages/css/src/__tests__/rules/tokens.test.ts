import { checkBlock } from "../../compiler/rules";
import { describe, expect, test } from "vitest";
import { findBlocks } from "../../compiler/scan";
import { namedSites } from "../../compiler/references";
import { readBlock } from "../../compiler/read";

/**
 * Setting one variable and reading another, when the author meant one.
 *
 * A named `@@property` block is a TypeScript binding, and `var($(accent))` resolves at build time to
 * the name that block generated. Setting it with the SAME binding works end to end — `$(accent):
 * blue` writes `--r-…: blue` and the `var()` reads it back.
 *
 * **Writing the literal name instead is two variables, and nothing said so.** Measured:
 *
 * ```
 * --accent: blue;               ->  .r-… { --accent: blue }       ONE variable
 * background: var($(accent));  ->  reads --r-k8u6ISIlk           ANOTHER
 * ```
 *
 * The author believes they set what they read. The background is the `@property` `initial-value`
 * instead, and the declaration they wrote does nothing for it. **This has to be reported before the
 * binding form is recommended anywhere**, or the recommendation creates the fault it exists to
 * remove.
 */
describe("a variable set by one name and read by another", () => {
  const bound = (css: string) => {
    const source = `const accent = @@property( syntax: "<color>"; inherits: true; initial-value: red; );\nconst c = @@(\n${css}\n);`;
    const references = namedSites(source);
    const sites = findBlocks(source);
    const site = sites[sites.length - 1];
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true, resolve: (one) => references.get(one) });
    return checkBlock(read.block, { at: site.at, references: references }).sort((a, b) => a.at - b.at);
  };

  test("setting the literal name while reading the binding is reported", () => {
    const found = bound("  --accent: blue;\n  background: var($(accent));");

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("custom-property-set-by-another-name");
    expect(found[0].message).toContain("accent");
  });

  test("the message says what to write instead", () => {
    expect(bound("  --accent: blue;\n  background: var($(accent));")[0].message).toContain("$(accent)");
  });

  test("it lands on the declaration the author has to change", () => {
    const found = bound("  --accent: blue;\n  background: var($(accent));");
    // The SET is the mistake — the read is what they meant.
    expect(found[0].length).toBe("--accent".length);
  });

  describe("what it must not report", () => {
    test.each([
      ["setting it with the binding, which is the right way", "  $(accent): blue;\n  background: var($(accent));"],
      ["reading the binding and setting nothing", "  background: var($(accent));"],
      ["setting a literal nobody reads as a binding", "  --gap: 8px;\n  gap: var(--gap);"],
      ["a literal whose name matches nothing bound", "  --tone: blue;\n  background: var($(accent));"],
      ["setting the literal and reading the literal", "  --accent: blue;\n  background: var(--accent);"],
    ])("%s", (_what, css) => {
      expect(bound(css)).toEqual([]);
    });
  });
});
