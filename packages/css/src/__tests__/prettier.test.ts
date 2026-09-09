import prettier from "prettier";
import { describe, expect, test } from "vitest";
import plugin from "../prettier";

/**
 * Prettier, measured rather than described.
 *
 * ## The fault this exists for
 *
 * Prettier is the third tool that cannot parse a file holding a block, and the one an editor is most
 * likely to reach for on save. Measured on a real file before this existed:
 * *"SyntaxError: ')' expected."* — it refuses. Nothing is mangled and nothing is lost, which is the
 * safe half, but the one gesture every editor offers stops working, and a person whose default
 * formatter is Prettier has no way round it.
 *
 * Everything below runs the real formatter.
 */

const format = (source: string) => prettier.format(source, { parser: "typescript", plugins: [plugin] });

describe("without the plugin", () => {
  test("Prettier refuses a file holding a block, which is why this package ships one", async () => {
    await expect(
      prettier.format(`const a = <div css=@@( display: flex; )>y</div>;\n`, { parser: "typescript" }),
    ).rejects.toThrow(/expected/);
  });
});

describe("with it", () => {
  test("a block written as a value keeps its line, and its CSS", async () => {
    const out = await format(`const panel   =   @@(\n  display: flex;\n  gap: 8px;\n);\n`);

    expect(out).toBe(`const panel = @@(\n  display: flex;\n  gap: 8px;\n);\n`);
  });

  test("a braced attribute is laid out where the printer put it", async () => {
    const out = await format(`const a = <div id="x" css={@@(\n  display: flex;\n)}>y</div>;\n`);

    expect(out).toContain("css={@@(");
    expect(out).toContain("    display: flex;");
    expect(out).toContain(")}");
  });

  /**
   * The one thing Prettier changes, and it is a deliberate cost rather than a bug. A bare attribute
   * cannot hold a placeholder Prettier will ask about — it prints a quoted attribute value itself and
   * never calls `embed` on it — so the placeholder is braced, and the block comes back braced. The
   * two compile to the same class, and the braced spelling is the one to reach for anyway.
   */
  test("a bare attribute comes back braced, and nothing else about it moves", async () => {
    const out = await format(`const a = <div css=@@(\n  display: flex;\n)>y</div>;\n`);

    expect(out).toContain("css={@@(");
    expect(out).not.toContain("css=@@(");
    expect(out).toContain("display: flex;");
  });

  test("the CSS inside is returned as written, holes and nesting and all", async () => {
    const source = `const panel = @@(\n  border-left: {\`\${w}px\`} solid #ff0055;\n  &:hover { color: red; }\n);\n`;
    const out = await format(source);

    expect(out).toContain("border-left: {`${w}px`} solid #ff0055;");
    expect(out).toContain("&:hover { color: red; }");
  });

  /** A formatter that does not settle is worse than one that refuses: it rewrites the file forever. */
  test("formatting twice changes nothing the second time", async () => {
    for (const source of [
      `const panel = @@(\n  display: flex;\n);\n`,
      `const a = <div id="x" css={@@(\n  display: flex;\n)}>y</div>;\n`,
      `const a = <div css=@@(\n  display: flex;\n)>y</div>;\n`,
    ]) {
      const once = await format(source);
      expect(await format(once)).toBe(once);
    }
  });

  test("a file with no block is exactly what Prettier alone makes of it", async () => {
    const source = `const a  =  1;\nexport   default a;\n`;

    expect(await format(source)).toBe(await prettier.format(source, { parser: "typescript" }));
  });

  /**
   * THE AUTHOR'S OWN TEXT is not a placeholder, however much it looks like one.
   *
   * This plugin supplies its own `stands`, and it used a CONSTANT — while `markerFor`, which exists
   * to make a marker the file does not already contain, covered only the default. Measured: a file
   * with a block in it and `` `@ramonda-css-block:0` `` anywhere else came back with that string
   * REPLACED by a copy of the block. The author's text, gone, from a formatter run.
   */
  test("a template literal that looks like the placeholder is left alone", async () => {
    const source = "const a = <div css=@@( color: red; )>x</div>;\nconst note = `@ramonda-css-block:0`;\n";

    expect(await format(source)).toContain("`@ramonda-css-block:0`");
  });

  test("and the block beside it is still formatted", async () => {
    const source = "const a = <div css=@@(\ncolor: red;\n)>x</div>;\nconst note = `@ramonda-css-block:0`;\n";
    const out = await format(source);

    expect(out).toContain("  color: red;");
    expect(out).toContain("`@ramonda-css-block:0`");
  });

  /** Two of them, so the grown marker has to clear the file rather than the first occurrence. */
  test("several of them are all left alone", async () => {
    const source =
      "const a = <div css=@@( color: red; )>x</div>;\n" +
      "const one = `@ramonda-css-block:0`;\nconst two = `@ramonda-css-block:1`;\n";
    const out = await format(source);

    expect(out).toContain("`@ramonda-css-block:0`");
    expect(out).toContain("`@ramonda-css-block:1`");
  });
});
