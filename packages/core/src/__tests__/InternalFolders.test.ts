import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Some folders are the framework's own machinery and must never be reachable
 * from the package entry.
 *
 * `PublicSurface.test.ts` pins the export NAMES; this pins where they may come
 * from. The two catch different mistakes: that one notices a new name, this one
 * notices a legitimate-sounding name re-exported out of an internal module —
 * `export { something } from "./helpers/…"`, which reads perfectly fine in a
 * diff and quietly makes an internal function public API.
 *
 * It was already true when this was written; `createTemplate` had been the last
 * `helpers/` export and was removed the same day. Nothing enforced it, which is
 * the only reason it could have drifted back.
 *
 * The rule, stated as folders rather than names:
 *
 * - `base/` — components, hooks, decorators: the API itself.
 * - `hydration/` — `renderToString` / `hydrateRoot`, the SSR entry points.
 * - `vdom/` — `h`, which the JSX transform calls by name.
 * - `types/`, `global` — type-level only.
 *
 * Everything else is internal: `helpers/` (support the render path calls),
 * `core/` (the diff, the task queue, the runtimes), `debug/` (DEV diagnostics,
 * stripped from production), `reactivity/` (State and the tracker — an app that
 * could reach `attach`/`detach` could leak exactly the way a list once did).
 */

const INTERNAL_FOLDERS = ["helpers", "core", "debug", "reactivity"];

const indexSource = readFileSync(resolve(__dirname, "../index.ts"), "utf8");

/** Every `./…` path an `export … from` line in index.ts points at. */
function reExportPaths(source: string): string[] {
  const paths: string[] = [];
  const pattern = /^export\b[^\n]*?\bfrom\s+["'](\.\/[^"']+)["']/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

describe("internal folders stay internal", () => {
  test("the parser finds the re-exports it is meant to check", () => {
    const paths = reExportPaths(indexSource);
    // A guard on the instrument: a regex that matched nothing would make every
    // assertion below pass while checking nothing at all.
    expect(paths.length).toBeGreaterThan(5);
    expect(paths).toContain("./base/Component");
    expect(paths).toContain("./base/decorators");
  });

  test("index.ts re-exports nothing from an internal folder", () => {
    const offenders = reExportPaths(indexSource).filter((path) =>
      INTERNAL_FOLDERS.some((folder) => path.startsWith(`./${folder}/`)),
    );

    expect(offenders).toEqual([]);
  });

  test("every re-export comes from a folder that is meant to be public", () => {
    const allowed = ["base", "hydration", "vdom", "types"];
    const unexpected = reExportPaths(indexSource).filter((path) => {
      const segments = path.slice(2).split("/");
      // `./global` has no folder — it is the JSX namespace declaration.
      if (segments.length === 1) return false;
      return !allowed.includes(segments[0]);
    });

    expect(unexpected).toEqual([]);
  });
});
