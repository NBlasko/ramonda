import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import * as api from "../index";
import * as vite from "../vite";
import * as esbuild from "../esbuild";

/**
 * What the main entry exports, asserted as a list.
 *
 * The same tripwire the other packages have, and this one is late: `settings.ts` exports seven
 * names, five of them plumbing the adapters share, and only two are meant to leave the package.
 * `check`, `fillIn` and the three refusals are one `export *` away from being API — and this
 * package's whole reason to exist is that a build setting cannot be got wrong quietly, which is a
 * promise it cannot keep about its own surface without a list somewhere.
 *
 * The docs' `check-api-coverage.mjs` reads this list too, so a new export here has to be
 * acknowledged twice — once as API, once as a row on /reference/build.
 */
const EXPECTED = ["PUBLIC_ENV_PREFIX", "RAMONDA_TRANSFORM", "lowersDecorators", "publicEnv"];

/**
 * The shared plumbing, which both adapters import and neither publishes.
 *
 * `check` and `fillIn` are the sharp ones. They are the halves of "refuse what disagrees, fill in
 * what was left unsaid", and an app calling them directly would be configuring the transform by
 * hand again with extra steps — the exact thing the package exists to take away.
 */
const FORBIDDEN = ["check", "fillIn", "refuse", "refuseOff", "refuseSetting", "refuseEnvPrefix", "envDefines"];

describe("public API surface", () => {
  test("the main entry exports exactly what it means to", () => {
    const actual = Object.keys(api).sort();
    const expected = [...EXPECTED].sort();

    const added = actual.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !actual.includes(name));

    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  test("the shared plumbing is not reachable", () => {
    for (const name of FORBIDDEN) {
      expect(api).not.toHaveProperty(name);
    }
  });

  /**
   * Each adapter is its own entry point, and an entry point is API.
   *
   * They are kept apart so that installing one does not drag the other's types along, and that
   * separation is only real if each one's surface is asserted where it lives. The esbuild half
   * publishes two names because a build assembled by a tool takes a plugin while a build you write
   * yourself would rather spread an object; Vite has no such split.
   */
  test("the Vite entry publishes the plugin and nothing else", () => {
    expect(Object.keys(vite).sort()).toEqual(["ramonda"]);
  });

  test("the esbuild entry publishes the plugin and the options", () => {
    expect(Object.keys(esbuild).sort()).toEqual(["ramonda", "ramondaDefine", "ramondaOptions"]);
  });
});

/**
 * The TYPES each build publishes, which `Object.keys` cannot see.
 *
 * The adapters describe Vite's and esbuild's shapes structurally rather than importing them, so
 * that this package's types do not make either bundler a dependency of anybody who installs it.
 * Those interfaces are a private detail of that decision — published, they would be a second,
 * worse declaration of somebody else's API, and one nobody here is maintaining.
 *
 * Read from the emitted `.d.ts` rather than from the source, because that file IS the published
 * surface: what tsup decided to include is the question, not what the entry looks like.
 */
describe("the published declarations", () => {
  const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");

  const declarations = (entry: string): string => {
    const file = join(dist, `${entry}.d.ts`);
    if (!existsSync(file)) {
      throw new Error(`${file} is not built. This asserts what the PUBLISHED types say, so run the build first.`);
    }
    return readFileSync(file, "utf8");
  };

  test("the structural stand-ins for Vite and esbuild stay internal", () => {
    for (const name of ["VitePluginLike", "UserConfigLike", "EsbuildOptionsLike", "EsbuildPluginLike"]) {
      for (const entry of ["index", "vite", "esbuild"]) {
        expect(declarations(entry)).not.toContain(`export { ${name}`);
        expect(declarations(entry)).not.toContain(`export type { ${name}`);
      }
    }
  });

  test("the main entry publishes exactly the named values and no types", () => {
    const exported = [...declarations("index").matchAll(/^export \{([^}]*)\};?/gms)]
      .flatMap(([, names]) => names.split(","))
      .map((name) => name.replace(/\btype\b/, "").trim())
      .filter(Boolean)
      .sort();

    expect(exported).toEqual(["PUBLIC_ENV_PREFIX", "RAMONDA_TRANSFORM", "lowersDecorators", "publicEnv"]);
  });
});
