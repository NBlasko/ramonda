import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "method-written-over", "tsconfig.json"));

/**
 * A method written over. A hook's props callback that hands one over reads no signal, so it runs
 * once — and in a production build the hook is not walked at all — so the write reaches nobody.
 */
describe("a method written over", () => {
  test("every write to a method is reported, the base's included, and nothing else", () => {
    const found = run().findings["method-written-over"];
    expect(found.map((one) => `${one.component}.${one.writtenIn}:${one.method}`)).toEqual([
      "Editor.constructor:submit",
      "Editor.swap:submit",
      "Editor.swap:save",
      "Editor.swap:submit",
      "Editor.swap:submit",
      "Editor.swap:submit",
    ]);
  });
});
