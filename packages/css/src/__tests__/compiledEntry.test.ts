// @vitest-environment node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { keyToken } from "../compiler/names";

/**
 * `@ramonda/css/compiled` and `@ramonda/css` are two entries over ONE merge module, read from the
 * BUILT files, because only the build can split it in two.
 *
 * `mergeClassNames` reads what `shorthands` registered. Emitted code registers through the compiled
 * entry and an author merges through the runtime entry, so a copy of the module per entry would
 * merge without clearing: a `padding-left` would survive a `padding` written after it, silently.
 */
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");
const classOf = (property: string, value: string) =>
  `r-${keyToken({ property, selector: "", conditions: [] })}-${value}`;
const load = (file: string) => import(pathToFileURL(join(DIST, file)).href);

describe("the compiled entry and the runtime entry share one merge", () => {
  test.each([
    ["development", "index.js", "compiled.js"],
    ["production", "index.prod.js", "compiled.prod.js"],
  ])("%s", async (_build, runtimeFile, compiledFile) => {
    expect(existsSync(join(DIST, compiledFile)), `${compiledFile} is built`).toBe(true);
    const compiled = await load(compiledFile);
    const runtime = await load(runtimeFile);

    expect(runtime.mergeClassNames).toBe(compiled.mergeClassNames);

    compiled.shorthands({ m: ["ml", "mr"] });
    expect(runtime.mergeClassNames(classOf("margin-left", "4px"), classOf("margin", "8px"))).toBe(
      classOf("margin", "8px"),
    );
  });
});
