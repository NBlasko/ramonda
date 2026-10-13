import { describe, expect, test } from "vitest";
import { build as viteBuild } from "vite";
import { build as vite7Build } from "vite-7";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ramonda } from "../vite";
import { PUBLIC_ENV_PREFIX } from "../settings";

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

  /**
   * `jsx` and `jsxImportSource` used to be returned unconditionally here while the esbuild adapter
   * filled them in with `??=` — so the same config was silently overridden by one half and silently
   * kept by the other, and only `target` was ever refused. Three behaviours for one principle.
   * Both adapters now answer this from the same helper; the esbuild half asserts the mirror image.
   */
  test.each(["jsx", "jsxImportSource"] as const)("a %s that disagrees is refused, not overridden", (name) => {
    const { config } = hooks(ramonda());
    const env = { command: "build", mode: "production" };

    expect(() => config({ esbuild: { [name]: "something-else" } }, env)).toThrow(new RegExp(name));
    expect(() => config({ esbuild: { [name]: "something-else" } }, env)).toThrow(/refused rather than corrected/);
  });

  test("one the app already set correctly is not handed back, so its line survives", () => {
    const { config } = hooks(ramonda());
    const returned = config({ esbuild: { jsx: "automatic" } }, { command: "build", mode: "production" }) as {
      esbuild: Record<string, unknown>;
    };

    expect(returned.esbuild).not.toHaveProperty("jsx");
    expect(returned.esbuild.jsxImportSource).toBe("@ramonda/core");
  });

  test("turning esbuild off entirely is refused too, and told what to actually do", () => {
    const { config } = hooks(ramonda());
    const off = () => config({ esbuild: false }, { command: "build", mode: "production" });

    expect(off).toThrow(/decorator/i);
    expect(off).toThrow(/Remove that line/);

    // It used to share the target's wording and end with "set it to `es2022`" — advice you cannot
    // follow on a line that reads `esbuild: false`, and the only path through that message where
    // the one useful sentence was wrong.
    expect(off).not.toThrow(/Set it to/);
  });

  test("and it checks the resolved config, in case something later put it back", () => {
    const { configResolved } = hooks(ramonda());
    // What Vite hands this hook has already been through `config` and the merge, so a healthy
    // resolved config carries the prefix — calling it without one is not a realistic arrangement.
    const resolved = { esbuild: { target: "es2022" }, envPrefix: PUBLIC_ENV_PREFIX };

    expect(() => configResolved(resolved)).not.toThrow();

    // Plugin order is not something this package controls, so the value it returned is not proof of
    // the value that survived. All three settings, not just the target.
    expect(() => configResolved({ ...resolved, esbuild: { target: "esnext" } })).toThrow(/decorator/i);
    expect(() => configResolved({ ...resolved, esbuild: { target: "es2022", jsxImportSource: "elsewhere" } })).toThrow(
      /jsxImportSource/,
    );
    // And the one nobody can walk back: a later plugin widening what reaches the browser.
    expect(() => configResolved({ ...resolved, envPrefix: "" })).toThrow(/envPrefix/);
    expect(() => configResolved({ ...resolved, envPrefix: ["RAMONDA_PUBLIC_", "VITE_"] })).toThrow(/envPrefix/);
  });

  /**
   * Which variables reach the browser, which is the one setting here whose mistake cannot be undone:
   * a secret that shipped, shipped.
   */
  describe("envPrefix", () => {
    test("it is filled in when the app said nothing", () => {
      const { config } = hooks(ramonda());
      const returned = config({}, { command: "build", mode: "production" }) as { envPrefix?: string };
      expect(returned.envPrefix).toBe(PUBLIC_ENV_PREFIX);
    });

    test("an app that set the same prefix keeps its own line", () => {
      const { config } = hooks(ramonda());
      // Not returned, because Vite merges over the app: returning it would replace a line that
      // already agrees, for no gain.
      const returned = config({ envPrefix: PUBLIC_ENV_PREFIX }, { command: "build", mode: "production" }) as
        | Record<string, unknown>
        | undefined;
      expect(returned !== undefined && "envPrefix" in returned).toBe(false);
    });

    test("the one-entry array spelling is the same answer", () => {
      const { config } = hooks(ramonda());
      const returned = config({ envPrefix: [PUBLIC_ENV_PREFIX] }, { command: "build", mode: "production" }) as
        | Record<string, unknown>
        | undefined;
      expect(returned !== undefined && "envPrefix" in returned).toBe(false);
    });

    test("a different prefix is REFUSED rather than overridden", () => {
      const { config } = hooks(ramonda());
      // Overriding would expose a different set of variables than the app asked for, in silence.
      expect(() => config({ envPrefix: "VITE_" }, { command: "build", mode: "production" })).toThrow(/envPrefix/);
      expect(() => config({ envPrefix: "" }, { command: "build", mode: "production" })).toThrow(/envPrefix/);
    });
  });
});

/**
 * Vite 8, which transforms with Oxc. The hook reads which Vite it is from `this.meta.viteVersion`,
 * so these call it the way Vite 8 does.
 */
describe("on Vite 8", () => {
  const VITE_8 = { meta: { viteVersion: "8.3.4" } };
  const env = { command: "build", mode: "production" };
  const on8 = () => {
    const plugin = ramonda();
    const { config, configResolved } = hooks(plugin);
    return { config: config.bind(VITE_8), configResolved, plugin };
  };

  test("the JSX settings go to Oxc, and nothing goes to the esbuild block Vite 8 only translates", () => {
    const returned = on8().config({}, env) as Record<string, unknown>;
    expect(returned.oxc).toEqual({ jsx: { runtime: "automatic", importSource: "@ramonda/core" } });
    expect(returned).not.toHaveProperty("esbuild");
    expect(returned.envPrefix).toBe(PUBLIC_ENV_PREFIX);
  });

  test("an app's own Oxc JSX that agrees is left as its own line", () => {
    const own = { oxc: { jsx: { runtime: "automatic", importSource: "@ramonda/core" } } };
    expect(on8().config(own, env)).not.toHaveProperty("oxc");
  });

  test("Oxc switched off, or told another JSX, is refused as esbuild is", () => {
    const { config } = on8();
    expect(() => config({ oxc: false }, env)).toThrow(/Remove that line/);
    expect(() => config({ oxc: { jsx: { runtime: "automatic", importSource: "preact" } } }, env)).toThrow(
      /jsxImportSource/,
    );
    expect(() => config({ oxc: { jsx: "preserve" } }, env)).toThrow(/`jsx`/);
  });

  test("the resolved config is checked for Oxc, and no esbuild target is asked for", () => {
    const { config, configResolved } = on8();
    config({}, env);
    // No `esbuild` at all: on Vite 8 the decorators are this plugin's own transform.
    expect(() => configResolved({ envPrefix: PUBLIC_ENV_PREFIX })).not.toThrow();
    expect(() => configResolved({ envPrefix: PUBLIC_ENV_PREFIX, oxc: false })).toThrow(/Remove that line/);
  });

  test("the transform lowers a decorator on Vite 8, and leaves the module alone on Vite 7", async () => {
    const source = `function Host(t) { return (v) => v; }\n@Host("div") export class A {}\n`;

    const eight = on8();
    eight.config({}, env);
    const lowered = await eight.plugin.transform.handler.call({}, source, "/app/src/A.tsx");
    expect(lowered?.code).not.toContain("@Host");

    const seven = ramonda();
    hooks(seven).config.call({ meta: { viteVersion: "7.3.6" } }, {}, env);
    expect(await seven.transform.handler.call({}, source, "/app/src/A.tsx")).toBeNull();
  });

  test("a dependency, a virtual module and a file with no decorator are not touched", async () => {
    const { config, plugin } = on8();
    config({}, env);
    const source = `@Host("div") export class A {}\n`;
    expect(await plugin.transform.handler.call({}, source, "/app/node_modules/x/index.js")).toBeNull();
    expect(await plugin.transform.handler.call({}, source, "\0virtual:x")).toBeNull();
    expect(await plugin.transform.handler.call({}, source, "/app/src/a.css")).toBeNull();
    expect(await plugin.transform.handler.call({}, "export const a = 1;\n", "/app/src/a.ts")).toBeNull();
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
async function bundle(
  build: typeof viteBuild,
  plugins: NonNullable<Parameters<typeof viteBuild>[0]>["plugins"],
  root: string,
  ssr = false,
) {
  const warnings: string[] = [];
  const result = (await build({
    root,
    configFile: false,
    customLogger: quiet(warnings),
    plugins,
    build: {
      target: "esnext",
      write: false,
      minify: false,
      // A server build takes its own path through Vite, and it is the one that left the decorators in
      // before this package existed — so it is asked separately rather than assumed from the client's.
      ...(ssr ? { ssr: join(root, "entry.ts") } : { lib: { entry: join(root, "entry.ts"), formats: ["es" as const] } }),
    },
  })) as { output: { code?: string }[] }[] | { output: { code?: string }[] };
  // Vite 8 hands back one result for a library build where Vite 7 handed back a list.
  const output = Array.isArray(result) ? result[0].output : result.output;
  return { code: output.map((chunk) => chunk.code ?? "").join("\n"), warnings };
}

/** A logger that keeps the warnings, so a test can ask whether Vite had anything to say. */
function quiet(warnings: string[]) {
  const ignore = () => {};
  return {
    info: ignore,
    warn: (message: string) => warnings.push(message),
    warnOnce: (message: string) => warnings.push(message),
    error: ignore,
    clearScreen: ignore,
    hasErrorLogged: () => false,
    hasWarned: false,
  };
}

/**
 * Both majors, because an app is on one or the other and the plugin answers each differently: Vite 7
 * transforms with esbuild, which lowers decorators when told a target, and Vite 8 with Oxc, which
 * cannot lower them at all.
 */
const VITES = [
  ["Vite 8", viteBuild],
  ["Vite 7", vite7Build as unknown as typeof viteBuild],
] as const;

describe.each(VITES)("what comes out of a real build, on %s", (_name, build) => {
  test.each([
    ["client", false],
    ["server", true],
  ])("without the plugin the decorator reaches the %s bundle; with it, it does not", async (_which, ssr) => {
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

      await writeFile(emitted, (await bundle(build, [], dir, ssr)).code);
      await expect(parses(emitted), "the fault should reproduce without the plugin").resolves.toBe(false);

      const fixed = await bundle(build, [ramonda()], dir, ssr);
      await writeFile(emitted, fixed.code);
      await expect(parses(emitted)).resolves.toBe(true);
      expect(fixed.code).not.toContain("@Host");

      // Nothing the plugin hands Vite is an option Vite has stopped reading. On Vite 8 `esbuild` is
      // translated with a warning, and translated into a transform that cannot lower decorators.
      expect(fixed.warnings.filter((one) => /deprecated/i.test(one))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
