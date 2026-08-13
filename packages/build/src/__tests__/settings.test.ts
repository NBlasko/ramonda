import { describe, expect, test } from "vitest";
import { transform } from "esbuild";
import { RAMONDA_TRANSFORM, lowersDecorators } from "../settings";

/**
 * The rule this package exists to enforce, checked against the thing it is a rule about.
 *
 * `lowersDecorators` is a claim about esbuild's behaviour, and a claim about a dependency is worth
 * nothing unless the dependency is asked. So the table below is not a list of values somebody
 * believed — every row is run through the real esbuild, and the assertion is that the predicate and
 * the compiler agree. When esbuild changes its mind, this fails here rather than in a user's browser.
 */

/** A decorator whose output is unambiguous to look for: if `@Host` is still in the text, it survived. */
const SOURCE = `function Host(t) { return (v, c) => v; }\n@Host("div") export class A { x = 1 }\n`;

async function survivesDecorator(target: string | string[]) {
  const { code } = await transform(SOURCE, { loader: "ts", target });
  return code.includes("@Host");
}

describe("the target rule", () => {
  /**
   * `esnext` means "assume the engine implements everything", and no engine implements decorators —
   * so esbuild leaves them exactly as written and emits a file nothing can parse. It is also
   * esbuild's DEFAULT, which is why an unset target is the same fault as a wrong one.
   */
  test.each([
    ["esnext", false],
    ["es2024", true],
    ["es2023", true],
    ["es2022", true],
    ["es2020", true],
    [["es2022", "chrome100"], true],
    // A list is the intersection of what its entries support, so one real engine among them is
    // enough — `esnext` only wins when there is nothing else to disagree with it.
    [["esnext", "chrome100"], true],
    [["esnext", "esnext"], false],
  ] as const)("%s", async (target, expected) => {
    expect(lowersDecorators(target as string | string[])).toBe(expected);
    expect(await survivesDecorator(target as string | string[])).toBe(!expected);
  });

  test("an unset target is not safe, because esbuild's default is esnext", async () => {
    expect(lowersDecorators(undefined)).toBe(false);

    const { code } = await transform(SOURCE, { loader: "ts" });
    expect(code).toContain("@Host");
  });

  test("the settings this package installs are the safe ones", () => {
    expect(lowersDecorators(RAMONDA_TRANSFORM.target)).toBe(true);
    expect(RAMONDA_TRANSFORM.jsx).toBe("automatic");
    expect(RAMONDA_TRANSFORM.jsxImportSource).toBe("@ramonda/core");
  });
});
