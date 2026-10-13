import { describe, expect, test } from "vitest";
import * as submodule from "../devtools";
import * as api from "../index";

/**
 * The `./devtools` entry, which the panel imports and an application does not.
 *
 * A second entry is a second public surface and `Object.keys` on the main one cannot see it. Nothing
 * asserted this one, and it is the seam a devtools client joins through — three names that another
 * package in this repository calls, which is a contract rather than a convenience.
 */
const EXPECTED = ["joinDevtools", "leaveDevtools", "registerDevtoolsClient"];

describe("the devtools entry", () => {
  test("exports exactly what it means to", () => {
    expect(Object.keys(submodule).sort()).toEqual([...EXPECTED].sort());
  });

  /** A name on both entries would be two things to keep in step, and one of them would drift. */
  test("and nothing the main entry already has", () => {
    for (const name of Object.keys(submodule)) expect(api).not.toHaveProperty(name);
  });
});
