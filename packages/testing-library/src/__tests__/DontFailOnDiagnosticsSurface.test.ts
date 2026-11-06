import { describe, expect, test } from "vitest";
import * as submodule from "../dont-fail-on-diagnostics";

/**
 * The `./dont-fail-on-diagnostics` entry exports nothing: importing it IS the effect, as with
 * `./dont-cleanup-after-each`. A name appearing here would mean the switch had become an API.
 */
describe("the dont-fail-on-diagnostics entry", () => {
  test("exports nothing — importing it IS the effect", () => {
    expect(Object.keys(submodule)).toEqual([]);
  });
});
