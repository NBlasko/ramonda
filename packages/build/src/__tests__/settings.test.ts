import { describe, expect, test } from "vitest";
import { transform } from "esbuild";
import ts from "typescript";
import { RAMONDA_TRANSFORM, lowersDecorators } from "../settings";

/**
 * The rule this package exists to enforce, checked against the things it is a rule about.
 *
 * `lowersDecorators` is a claim about a compiler's behaviour, and a claim about a dependency is
 * worth nothing unless the dependency is asked. So the table below is not a list of values somebody
 * believed — every row is run through the real compiler, and the assertion is that the predicate and
 * the compiler agree. When one of them changes its mind, this fails here rather than in a user's
 * browser.
 *
 * **Both compilers, on purpose.** esbuild is what this package's two adapters drive, and it is where
 * the fault shipped. TypeScript is here because of what the README tells anyone wiring up a bundler
 * there is no adapter for: it hands them `lowersDecorators` and says the rule holds. A webpack or
 * rollup toolchain most often lowers TypeScript with `tsc` rather than esbuild, so that sentence is
 * a promise about a compiler nothing here was asking. Measured, they agree exactly — `esnext` leaves
 * the decorators in, everything below it compiles them away — and this is what keeps them agreeing.
 */

/** A decorator whose output is unambiguous to look for: if `@Host` is still in the text, it survived. */
const SOURCE = `function Host(t) { return (v, c) => v; }\n@Host("div") export class A { x = 1 }\n`;

async function survivesDecorator(target: string | string[]) {
  const { code } = await transform(SOURCE, { loader: "ts", target });
  return code.includes("@Host");
}

/**
 * `transpileModule` rather than a program, because that is the mode the loaders use — ts-loader's
 * `transpileOnly`, and every esbuild-style single-file transform. It is also the only mode where
 * the question is purely "what did the target do", with no type errors in the way.
 */
function survivesDecoratorInTs(target: ts.ScriptTarget) {
  const { outputText } = ts.transpileModule(SOURCE, {
    compilerOptions: { target, module: ts.ModuleKind.ESNext },
  });
  return outputText.includes("@Host");
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

  /**
   * The same rule, asked of TypeScript, because the README hands `lowersDecorators` to anyone
   * wiring up a bundler this package has no adapter for — and that toolchain is far more likely to
   * be running `tsc` than esbuild. Fewer rows than above: `tsc` takes one target, never a list.
   */
  test.each([
    // Spelled out rather than read back off the enum: `ESNext` and `Latest` share a value, so a
    // reverse lookup answers "latest" and the predicate is then asked about the wrong string.
    ["esnext", ts.ScriptTarget.ESNext, false],
    ["es2022", ts.ScriptTarget.ES2022, true],
    ["es2020", ts.ScriptTarget.ES2020, true],
  ] as const)("tsc %s", (name, target, expected) => {
    expect(lowersDecorators(name)).toBe(expected);
    expect(survivesDecoratorInTs(target)).toBe(!expected);
  });

  test("the settings this package installs are the safe ones", () => {
    expect(lowersDecorators(RAMONDA_TRANSFORM.target)).toBe(true);
    expect(RAMONDA_TRANSFORM.jsx).toBe("automatic");
    expect(RAMONDA_TRANSFORM.jsxImportSource).toBe("@ramonda/core");
  });
});
