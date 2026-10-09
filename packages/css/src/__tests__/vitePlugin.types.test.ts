import type { Plugin as Plugin8 } from "vite";
import type { Plugin as Plugin7 } from "vite-7";
import { expect, test } from "vitest";
import { ramondaCss } from "../adapters/vite";

/**
 * The plugin is what an app's `vite.config.ts` holds, and that file is type-checked with the app.
 *
 * The plugin's types are structural — Vite is not a dependency — so nothing here would notice a hook
 * drifting from what Vite declares. One did: `hotUpdate` returned `unknown[]`, which neither Vite 7
 * nor Vite 8 accepts, and every typed config holding the plugin stopped compiling. The assertions are
 * the assignments, which `tsc` checks, against each major an app may be on.
 */
test("the plugin is a Vite plugin to Vite 8 and to Vite 7", () => {
  const eight: Plugin8 = ramondaCss();
  const seven: Plugin7 = ramondaCss();
  expect([eight.name, seven.name]).toEqual(["ramonda-css", "ramonda-css"]);
});
