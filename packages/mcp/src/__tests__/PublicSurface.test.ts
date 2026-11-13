import { describe, expect, test } from "vitest";
import * as api from "../index";
import type { ServerOptions } from "../index";

/**
 * What this package publishes, asserted as a list — the tripwire every package here has. The server is
 * reached through `ramonda-mcp`; `createServer` is for a host that serves it some other way.
 *
 * The docs' `check-api-coverage.mjs` reads these lists too, so a new export has to be acknowledged
 * twice: once as API here, once as a row on /reference/api.
 */
const EXPECTED = ["createServer"];

/** The TYPES, which `Object.keys` cannot see because types are erased. */
const EXPECTED_TYPES = ["ServerOptions"];

describe("public API surface", () => {
  test("the entry exports exactly what it means to", () => {
    expect(Object.keys(api).sort()).toEqual([...EXPECTED].sort());
  });

  /** Each listed type, named — `check-types` fails here the day one stops being exported. */
  test("every listed type is exported", () => {
    const options: ServerOptions = { cwd: "/app", version: "0.1.0" };
    expect(EXPECTED_TYPES).toEqual(["ServerOptions"]);
    expect(options.cwd).toBe("/app");
  });
});
