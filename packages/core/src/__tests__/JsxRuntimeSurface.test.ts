import { describe, expect, test } from "vitest";
import * as dev from "../jsx-dev-runtime";
import * as runtime from "../jsx-runtime";

/**
 * The two JSX entries, whose names are not this package's to choose.
 *
 * `jsx: "react-jsx"` compiles `<div />` to a call on a module it resolves from `jsxImportSource`,
 * and it decides what to import: `jsx`, `jsxs` and `Fragment` in a production build, `jsxDEV` and
 * `Fragment` in a development one. A name missing here is not a smaller API — it is every element in
 * every file of every project failing to resolve, and the failure arrives from the compiler rather
 * than from anything this repository prints.
 *
 * **Nothing asserted either of them.** `PublicSurface.test.ts` watches `../index` and these are two
 * more entries in `package.json`, so a rename or a tree-shake that dropped one would have been
 * caught by whichever project upgraded first. A list per entry is what the rest of this repository
 * already does; these two were missed.
 */
/**
 * `__template` and `__block` are what Ramonda's own compiler writes for an element tree whose shape never
 * changes (see `core/block.ts`). Both entries carry them: a production build's compiled modules import
 * from `jsx-runtime`, a development build's from `jsx-dev-runtime` — removing either fails every compiled
 * app at import.
 */
const RUNTIME = ["Fragment", "__block", "__template", "jsx", "jsxs"];

/** `jsxDEV` takes the source location the production one has no argument for. */
const DEV = ["Fragment", "__block", "__template", "jsxDEV"];

describe("the JSX runtime entries", () => {
  test("`jsx-runtime` exports exactly what the transform imports", () => {
    expect(Object.keys(runtime).sort()).toEqual([...RUNTIME].sort());
  });

  test("`jsx-dev-runtime` exports exactly what the development transform imports", () => {
    expect(Object.keys(dev).sort()).toEqual([...DEV].sort());
  });

  /**
   * `Fragment` is in both because the transform imports it from whichever one it resolved, and the
   * two must be the SAME value — a `<>…</>` that compared unequal across a development and a
   * production chunk would be a different element type to the diff.
   */
  test("and `Fragment` is one value, not two", () => {
    expect(dev.Fragment).toBe(runtime.Fragment);
  });

  /**
   * The same for the compiler's two: a block made by one entry's `__block` carries that module's `BLOCK`
   * symbol, and a copy that differed would be read by the diff as an ordinary element.
   */
  test("and `__template` and `__block` are each one value, not two", () => {
    expect(dev.__template).toBe(runtime.__template);
    expect(dev.__block).toBe(runtime.__block);
  });
});
