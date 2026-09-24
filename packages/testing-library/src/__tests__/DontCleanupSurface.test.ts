import { describe, expect, test } from "vitest";
import * as submodule from "../dont-cleanup-after-each";

/**
 * The `./dont-cleanup-after-each` entry, which exports nothing and is imported for what it DOES.
 *
 * A published entry with an empty surface is still a published entry, and it was the one nothing
 * asserted. The assertion is the whole contract: a name appearing here would mean the module had
 * stopped being a switch and become an API, and a reader who imported it for the side effect would
 * be carrying something they never asked for.
 */
describe("the dont-cleanup-after-each entry", () => {
  test("exports nothing — importing it IS the effect", () => {
    expect(Object.keys(submodule)).toEqual([]);
  });
});
