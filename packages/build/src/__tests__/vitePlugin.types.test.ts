import type { Plugin as Plugin8 } from "vite";
import type { Plugin as Plugin7 } from "vite-7";
import { expect, test } from "vitest";
import { ramonda } from "../vite";

/**
 * The plugins are what an app's `vite.config.ts` holds, and that file is type-checked with the app.
 *
 * Its types are structural — Vite is not a dependency of this package — so a hook that drifted from
 * what Vite declares would be noticed first by somebody's editor. The assertions are the
 * assignments, which `tsc` checks, against each major an app may be on.
 */
test("the plugins are Vite plugins to Vite 8 and to Vite 7", () => {
  const eight: Plugin8[] = ramonda();
  const seven: Plugin7[] = ramonda();
  expect([eight.map((plugin) => plugin.name), seven.map((plugin) => plugin.name)]).toEqual([
    ["ramonda", "ramonda:compile"],
    ["ramonda", "ramonda:compile"],
  ]);
});
