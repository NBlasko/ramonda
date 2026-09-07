import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type ts from "typescript";

/**
 * The project's own settings — what `ramonda-css lint`, `ramonda-css format` and the editor must
 * agree about.
 *
 * ## Why this is not where the build's options live
 *
 * `vite.config.ts` already receives the mode, in TypeScript, for free: a project that wants hashed
 * class names in production writes `ramondaCss({ names: mode === "production" ? "hash" : … })` and
 * needs nothing here. A second place to configure the build would be a second thing to keep in step.
 *
 * What plugin options cannot reach is the two CLIs and the editor, none of which reads a bundler's
 * config. So this file holds the rules those three share, and only those.
 *
 * ## Why TypeScript rather than JSON
 *
 * A setting may depend on the environment, and a config that is a FUNCTION of the environment cannot
 * be JSON. See {@link readConfig} for how that is affordable inside an editor.
 */
export interface Config {
  /**
   * The units a value may use — everything else is reported.
   *
   * A project rule rather than a CSS one: `em` is valid CSS and a team may still have decided
   * against it. Absent, every unit CSS has is fine.
   */
  readonly units?: readonly string[];
  /** A rule's severity, by id. `"off"` silences it; `"error"` is the default for every rule. */
  readonly rules?: Readonly<Record<string, "error" | "off">>;
  /** How the formatter lays a block out. */
  readonly format?: {
    /** Spaces per level inside a block. Defaults to 2. */
    readonly indent?: number;
  };
}

/** What a config may be given, when it is a function rather than an object. */
export interface ConfigEnvironment {
  readonly production?: boolean;
}

/**
 * The keys this refuses, and why refusing them is not a limitation.
 *
 * Identity is the one thing every consumer of this package must agree about: the class is a hash of
 * the normalised block, and two projects — or two packages in one app — that named the same block
 * differently would emit two rules for it, with no registry to notice. `CONTRACT.md` §3 says the
 * prefix is fixed for exactly this reason, and the same argument covers the hash and normalisation.
 */
const IDENTITY = new Set(["prefix", "hash", "normalise", "normalize", "names", "layer"]);

/** Everything a config may hold. An unknown key is a typo, and a typo that is ignored is invisible. */
const KNOWN = new Set(["units", "rules", "format"]);

/** Walks up from `from` looking for the file. `undefined` when a project has none, which is fine. */
export function findConfig(from: string): string | undefined {
  let directory = from;

  for (;;) {
    const candidate = join(directory, "ramonda.css.ts");
    if (existsSync(candidate)) return candidate;

    const above = dirname(directory);
    if (above === directory) return undefined;
    directory = above;
  }
}

/**
 * Reads a config, transpiling it with the TypeScript that is already in the process.
 *
 * **That is the whole reason this works inside an editor**, and it was measured before it was
 * written. A `tsserver` plugin is CommonJS with no `ts-node`, so loading a `.ts` file looked like the
 * blocker. It is not: tsserver HANDS the plugin the `typescript` object, so the config is transpiled
 * by the same compiler the project is checked with.
 *
 * The two alternatives both work on Node 24 and were rejected for the same reason: `require(".ts")`
 * (type stripping) and `import(".ts")` tie the config to whatever Node the editor happens to embed,
 * and type stripping additionally refuses TypeScript that is not erasable — an `enum` in somebody's
 * config would fail in the editor and pass in the build.
 *
 * A config that throws is REPORTED. A tool that quietly ran with defaults because somebody's config
 * had a typo would be the worst of both: the settings are not applied, and nothing says so.
 */
export function readConfig(
  path: string | undefined,
  typescript: typeof ts,
  environment: ConfigEnvironment = {},
): Config {
  if (path === undefined) return {};

  let exported: unknown;
  try {
    const javascript = typescript.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2022,
      },
      fileName: path,
    }).outputText;

    const holder: { exports: Record<string, unknown> } = { exports: {} };
    const require = createRequire(path);
    new Function("module", "exports", "require", javascript)(holder, holder.exports, require);
    exported = holder.exports.default;
  } catch (error) {
    throw new Error(`${path} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (exported === undefined) {
    throw new Error(`${path} has no default export — write \`export default { … }\`.`);
  }

  const config =
    typeof exported === "function" ? (exported as (env: ConfigEnvironment) => unknown)(environment) : exported;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error(`${path} must export an object, or a function returning one.`);
  }

  for (const key of Object.keys(config)) {
    if (IDENTITY.has(key)) {
      throw new Error(
        `${path} sets \`${key}\`, which decides a block's IDENTITY and cannot be a project setting. ` +
          `Two packages naming one block differently would emit two rules for it, with nothing to ` +
          `notice — see CONTRACT.md §3. Class names are chosen by the bundler plugin, per build.`,
      );
    }
    if (!KNOWN.has(key)) {
      throw new Error(`${path} sets \`${key}\`, which is not a setting. It holds ${[...KNOWN].join(", ")}.`);
    }
  }

  return config as Config;
}
