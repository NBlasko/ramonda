import { describe, expect, test } from "vitest";
import { build as viteBuild } from "vite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ramonda } from "../vite";

function parses(file: string) {
  return new Promise<boolean>((resolve) => {
    execFile(process.execPath, ["--check", file], (error) => resolve(!error));
  });
}

/**
 * The plugin, exercised through Vite's own hooks rather than by reading its source.
 *
 * `config` and `configResolved` are called by hand where the assertion is about what the plugin
 * decides, and a real `vite build` is run where the assertion is about what comes out — because the
 * whole point of the package is the output, and a plugin that returns the right object into a
 * pipeline that ignores it would pass every unit test and still ship a broken bundle.
 */

/** The hooks as Vite will actually call them — object form, so `handler` is where the function is. */
function hooks(plugin: ReturnType<typeof ramonda>) {
  const config = plugin.config as (config: Record<string, unknown>, env: unknown) => unknown;
  const configResolved = plugin.configResolved as (config: Record<string, unknown>) => void;
  return { config, configResolved };
}

describe("what the plugin puts in the config", () => {
  test("all three settings, so the app names none of them", () => {
    const { config } = hooks(ramonda());
    const returned = config({}, { command: "build", mode: "production" }) as {
      esbuild: { jsx: string; jsxImportSource: string; target: string };
    };

    expect(returned.esbuild.jsx).toBe("automatic");
    expect(returned.esbuild.jsxImportSource).toBe("@ramonda/core");
    expect(returned.esbuild.target).toBe("es2022");
  });

  test("a target the app already set, and that works, is left alone", () => {
    const { config } = hooks(ramonda());
    const returned = config({ esbuild: { target: "es2020" } }, { command: "build", mode: "production" }) as {
      esbuild: Record<string, unknown>;
    };

    // Returning `target` here would win over the app's own value — Vite merges the plugin's partial
    // config OVER the user's. Silently replacing a setting that was already correct is worse than
    // leaving it, and would make the plugin impossible to opt out of a piece at a time.
    expect(returned.esbuild).not.toHaveProperty("target");
  });

  test("a target that leaves the decorators in is refused, not overridden", () => {
    const { config } = hooks(ramonda());

    // The plugin COULD win this one silently, and that is exactly why it must not: the app said
    // something specific, it is wrong, and the person who wrote it needs to hear which line.
    expect(() => config({ esbuild: { target: "esnext" } }, { command: "build", mode: "production" })).toThrow(/esnext/);
    expect(() => config({ esbuild: { target: "esnext" } }, { command: "build", mode: "production" })).toThrow(
      /decorator/i,
    );
  });

  test("turning esbuild off entirely is refused too", () => {
    const { config } = hooks(ramonda());
    expect(() => config({ esbuild: false }, { command: "build", mode: "production" })).toThrow(/decorator/i);
  });

  test("and it checks the resolved config, in case something later put it back", () => {
    const { configResolved } = hooks(ramonda());

    expect(() => configResolved({ esbuild: { target: "es2022" } })).not.toThrow();

    // Plugin order is not something this package controls, so the value it returned is not proof of
    // the value that survived.
    expect(() => configResolved({ esbuild: { target: "esnext" } })).toThrow(/decorator/i);
  });
});

/**
 * A real `vite build`, twice: once without the plugin, so the fault is on the record, and once with
 * it. The first half is not decoration — a test that only ever runs the fixed arrangement cannot
 * tell you the fix is what fixed it.
 *
 * Two details of the fixture are load-bearing, and both were found by getting them wrong:
 *
 * A **tsconfig.json has to be there**. Without one Vite lowers decorators no matter what it is told,
 * so a fixture with no tsconfig passes with the plugin removed and proves nothing. Every real
 * project has one.
 *
 * And **`build.target` has to be `esnext` too**. Vite runs esbuild twice — once per module, once
 * over the output — and either pass will lower the decorators, so leaving `build.target` at its
 * default hides the fault the same way.
 */
async function bundle(plugins: NonNullable<Parameters<typeof viteBuild>[0]>["plugins"], root: string) {
  const result = (await viteBuild({
    root,
    logLevel: "silent",
    configFile: false,
    plugins,
    build: { target: "esnext", write: false, minify: false, lib: { entry: join(root, "entry.ts"), formats: ["es"] } },
  })) as { output: { code?: string }[] }[];
  return result[0].output.map((chunk) => chunk.code ?? "").join("\n");
}

describe("what comes out of a real build", () => {
  test("without the plugin the decorator reaches the bundle; with it, it does not", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ramonda-build-vite-"));
    try {
      await writeFile(
        join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "bundler" } }),
      );
      await writeFile(
        join(dir, "entry.ts"),
        `function Host(t: string) { return (v: unknown) => v; }\n` +
          `@Host("div") export class A { x = 1 }\n` +
          `export const used = new A();\n`,
      );

      /**
       * The oracle is `node --check`, the same one `ramonda-check-bundle` uses and for the same
       * reason: the question is "can an engine read this", so an engine has to answer it. Searching
       * the text for a decorator is the weaker check and it is also easy to get wrong — the emitted
       * form here is `@Host()`, not the `@Host("div")` that was written.
       */
      const emitted = join(dir, "out.mjs");

      await writeFile(emitted, await bundle([], dir));
      await expect(parses(emitted), "the fault should reproduce without the plugin").resolves.toBe(false);

      const fixed = await bundle([ramonda()], dir);
      await writeFile(emitted, fixed);
      await expect(parses(emitted)).resolves.toBe(true);
      expect(fixed).not.toContain("@Host");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
