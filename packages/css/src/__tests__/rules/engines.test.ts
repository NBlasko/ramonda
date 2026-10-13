import { checkBlock } from "../../compiler/rules";
import { describe, expect, test } from "vitest";
import { findBlocks } from "../../compiler/scan";
import { readBlock } from "../../compiler/read";

/**
 * A shorthand the engines RESET differently — `RESETS_DIFFER`, measured by
 * `build-shorthand-leaves.mjs`. `-webkit-mask` resets `mask-clip`, `mask-composite` and `mask-mode`
 * in Chromium and Firefox and keeps them in WebKit, so the author's own line renders two ways and no
 * split can fix that. It is refused, and `mask` is named, which every engine has.
 */
describe("a shorthand the engines reset differently", () => {
  const found = (css: string) => {
    const source = `<div className={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, {});
  };

  test("is reported, naming the longhands and the standard property", () => {
    const [finding] = found("-webkit-mask: url(a.png);").filter((one) => one.rule === "resets-differ-across-engines");
    expect(finding?.message).toContain("mask-mode");
    expect(finding?.message).toContain("`mask`");
  });

  test("and so it is inside a condition", () => {
    expect(found("@media (min-width: 40rem) { -webkit-mask: none; }").map((one) => one.rule)).toContain(
      "resets-differ-across-engines",
    );
  });

  test.each(["mask: url(a.png);", "-webkit-mask-image: url(a.png);", "background: red;"])("%s is not", (css) => {
    expect(found(css).map((one) => one.rule)).not.toContain("resets-differ-across-engines");
  });
});

/**
 * A VALUE the engines read differently — `contested` on a grammar shape, measured by the generator.
 * `animation: auto` is `animation-name: auto` in Firefox and a duration in Chromium and WebKit, so
 * the line renders two ways. Refused, like a shorthand the engines reset differently.
 */
describe("a value the engines read differently", () => {
  const found = (css: string) => {
    const source = `<div className={@@(\n${css}\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    return checkBlock(read.block, {});
  };

  test.each(["animation: auto;", "animation: spin auto;", "animation: spin 1s, auto;"])("%s is reported", (css) => {
    const finding = found(css).find((one) => one.rule === "value-differs-across-engines");
    expect(finding?.message).toContain("`auto`");
  });

  test("the finding is on the word, not on the first place its letters appear", () => {
    const css = "animation: autoslide auto;";
    const finding = found(css).find((one) => one.rule === "value-differs-across-engines");
    const source = `<div className={@@(\n${css}\n)}>x</div>`;
    expect(source.slice(finding?.at ?? 0, (finding?.at ?? 0) + 5)).toBe("auto;");
  });

  test.each(["animation: spin 1s;", "animation-duration: auto;", "animation: none;"])("%s is not", (css) => {
    expect(found(css).map((one) => one.rule)).not.toContain("value-differs-across-engines");
  });
});

describe("a value one engine does not have is not an error", () => {
  test("text-wrap: pretty is not reported as read differently", () => {
    const source = `<div className={@@(\ntext-wrap: pretty;\n)}>x</div>`;
    const [site] = findBlocks(source);
    const read = readBlock(source, site.open, "Card.tsx", { tolerant: true });
    expect(checkBlock(read.block, {}).map((one) => one.rule)).not.toContain("value-differs-across-engines");
  });
});
