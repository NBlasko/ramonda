import { describe, expect, test } from "vitest";
import { build as esbuild } from "esbuild";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ramonda, ramondaDefine, ramondaOptions } from "../esbuild";
import { envDefines, publicEnv } from "../settings";

/**
 * esbuild is where this actually went wrong, and the reason is one line of its documentation: the
 * default target is `esnext`. A build that says nothing about a target gets the one value that
 * leaves the decorators in — so "forgot to configure it" and "configured it wrongly" are the same
 * bug, and neither of them says a word at build time.
 */

const SOURCE =
  `function Host(t: string) { return (v: unknown) => v; }\n` +
  `@Host("div") export class A { x = 1 }\n` +
  `export const used = new A();\n`;

async function bundleWith(options: Parameters<typeof esbuild>[0]) {
  const dir = await mkdtemp(join(tmpdir(), "ramonda-build-esbuild-"));
  try {
    const entry = join(dir, "entry.ts");
    await writeFile(entry, SOURCE);
    const result = await esbuild({ ...options, entryPoints: [entry], bundle: true, format: "esm", write: false });
    const code = result.outputFiles.map((file) => file.text).join("\n");

    // `node --check` rather than a search for `@Host`, because the emitted spelling of a surviving
    // decorator is not the one that was written and the question is only ever whether it parses.
    const emitted = join(dir, "out.mjs");
    await writeFile(emitted, code);
    return await new Promise<boolean>((resolve) =>
      execFile(process.execPath, ["--check", emitted], (e) => resolve(!e)),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("the options object", () => {
  test("spreading it into a build is enough", async () => {
    await expect(bundleWith({ ...ramondaOptions })).resolves.toBe(true);
  });

  test("without it, the same build emits something no engine can read — the fault, reproduced", async () => {
    await expect(bundleWith({})).resolves.toBe(false);
  });
});

describe("the plugin", () => {
  test("fills in what the build did not set", async () => {
    await expect(bundleWith({ plugins: [ramonda()] })).resolves.toBe(true);
  });

  test("refuses a target that leaves them in, rather than overriding it", async () => {
    await expect(bundleWith({ target: "esnext", plugins: [ramonda()] })).rejects.toThrow(/decorator/i);
  });

  /**
   * The mirror of the Vite half's case. This adapter used to fill these in with `??=`, which means
   * it KEPT a value that disagrees — so a build with the wrong `jsxImportSource` went ahead and
   * failed later, on a module resolution, pointing at a file that was not the problem.
   */
  test.each(["jsx", "jsxImportSource"] as const)(
    "refuses a %s that disagrees, rather than keeping it",
    async (name) => {
      // Asserted on OUR sentence, not just the setting's name: esbuild validates `jsx` itself, so a
      // bare name match would pass on esbuild's own complaint even with this plugin doing nothing.
      await expect(bundleWith({ [name]: "something-else", plugins: [ramonda()] })).rejects.toThrow(
        /refused rather than corrected/,
      );
    },
  );

  test("leaves a target that already works", async () => {
    let seen: unknown;
    const parsed = await bundleWith({
      target: "es2020",
      plugins: [ramonda(), { name: "spy", setup: (build) => void (seen = build.initialOptions.target) }],
    });

    expect(seen).toBe("es2020");
    expect(parsed).toBe(true);
  });
});

/**
 * `import.meta.env`, and the two things that measurement showed were not obvious.
 *
 * esbuild neither provides `import.meta.env` nor complains about a read of it: an undefined key stays a
 * live reference, and `import.meta.env` is undefined at runtime, so the read THROWS in a browser. So the
 * floor object has to be defined as well as each key — and the floor object is the trap in this whole
 * feature, because putting `process.env` in it would ship every secret the build machine had.
 */
describe("environment variables", () => {
  const ENV = {
    RAMONDA_PUBLIC_API_BASE: "https://api.example.com",
    RAMONDA_SESSION_SECRET: "super-secret-value",
    DATABASE_URL: "postgres://nope",
    NOT_RAMONDA: "x",
  };

  /** Bundles a source of its own, because this question is about reads rather than decorators. */
  async function bundleSource(source: string, options: Parameters<typeof esbuild>[0]) {
    const dir = await mkdtemp(join(tmpdir(), "ramonda-build-env-"));
    try {
      const entry = join(dir, "entry.ts");
      await writeFile(entry, source);
      const result = await esbuild({
        ...options,
        entryPoints: [entry],
        bundle: true,
        format: "esm",
        write: false,
      });
      return result.outputFiles.map((file) => file.text).join("\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const READS =
    `export const shown = import.meta.env.RAMONDA_PUBLIC_API_BASE;\n` +
    `export const secret = import.meta.env.RAMONDA_SESSION_SECRET;\n` +
    `export const missing = import.meta.env.RAMONDA_PUBLIC_NOT_SET;\n`;

  test("publicEnv takes the prefixed names and nothing else", () => {
    expect(publicEnv(ENV)).toEqual({ RAMONDA_PUBLIC_API_BASE: "https://api.example.com" });
  });

  test("envDefines emits the floor object AND each key, and the floor holds only public names", () => {
    const defines = envDefines(ENV);

    // The floor, so an unknown key reads `undefined` rather than throwing.
    expect(JSON.parse(defines["import.meta.env"])).toEqual({
      RAMONDA_PUBLIC_API_BASE: "https://api.example.com",
    });
    // The per-key entry, which is what gets inlined as a literal.
    expect(defines["import.meta.env.RAMONDA_PUBLIC_API_BASE"]).toBe('"https://api.example.com"');
    // And nothing for the secret, under either shape.
    expect(defines["import.meta.env.RAMONDA_SESSION_SECRET"]).toBeUndefined();
    expect(defines["import.meta.env"]).not.toContain("super-secret-value");
  });

  test("the plugin inlines the public value and leaves no trace of the others", async () => {
    const before = { ...process.env };
    Object.assign(process.env, ENV);
    try {
      const code = await bundleSource(READS, { plugins: [ramonda()] });

      expect(code).toContain('"https://api.example.com"');
      // The value, not just the name: a bundle that carried it under any spelling would fail here.
      expect(code).not.toContain("super-secret-value");
      expect(code).not.toContain("postgres://nope");
      // And no read is left as a live reference, which is what would throw in a browser.
      expect(code).not.toMatch(/import\.meta\.env\./);
    } finally {
      for (const key of Object.keys(ENV)) delete process.env[key];
      Object.assign(process.env, before);
    }
  });

  test("the plugin merges UNDER a define the build already made", async () => {
    const before = { ...process.env };
    Object.assign(process.env, ENV);
    try {
      const code = await bundleSource(`export const dev = __DEV__;\n`, {
        plugins: [ramonda()],
        define: { __DEV__: "false" },
      });
      // Replacing `define` rather than merging would take `__DEV__` away and leave it undeclared.
      expect(code).toContain("false");
    } finally {
      for (const key of Object.keys(ENV)) delete process.env[key];
      Object.assign(process.env, before);
    }
  });

  test("ramondaDefine lets the caller's own name win", () => {
    const before = { ...process.env };
    Object.assign(process.env, ENV);
    try {
      const defines = ramondaDefine({ __DEV__: "false", "import.meta.env": '{"MINE":1}' });
      expect(defines.__DEV__).toBe("false");
      // The caller asked for it explicitly, so it wins — refusing here would be surprising in a
      // function whose whole job is to be merged into.
      expect(defines["import.meta.env"]).toBe('{"MINE":1}');
    } finally {
      for (const key of Object.keys(ENV)) delete process.env[key];
      Object.assign(process.env, before);
    }
  });
});
