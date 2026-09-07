import { existsSync, readFileSync } from "node:fs";
import { RULE_IDS, nearest } from "./compiler/rules";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
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
 * What `production` means to each consumer, in ONE place, because there are four of them.
 *
 * A review found this wired nowhere: every caller passed two arguments, so `environment` was always
 * `{}` and `env.production` was always `undefined` — while the docs gave
 * `env.production ? ["px"] : ["px", "rem", "em"]` as the example, and this package's own reason for
 * the config being TypeScript rather than JSON is that a setting may depend on the environment. It
 * silently took the development branch of every such config, in production builds included.
 *
 * The mechanism had a test and the WIRING had none, which is the shape to watch for: a unit test
 * proves the function, and nothing proves anybody calls it properly.
 *
 * A consumer that genuinely knows says so — a bundler is told which build this is. One that cannot
 * know falls back to `NODE_ENV`, which is the convention every tool in the ecosystem already reads.
 * An EDITOR passes `false` and means it: an editor session is a development session, and an author
 * whose config is stricter in production is choosing to meet those errors in CI, the same trade
 * every project already makes with `NODE_ENV`.
 */
export function environmentOf(production?: boolean): ConfigEnvironment {
  return { production: production ?? process.env.NODE_ENV === "production" };
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

/**
 * Walks up from `from` looking for the file. `undefined` when a project has none, which is fine.
 *
 * **Where it stops matters more than where it looks**, because this file is not merely read: it is
 * transpiled and run through `new Function`, inside `tsserver`, on merely opening a folder, and
 * nothing is shown to say which file was loaded. Until a review found it, the only stop was the
 * filesystem root — so a `ramonda.css.ts` left in a home directory from an experiment, or unzipped
 * beside a downloaded project, silently became the settings of every project opened afterwards.
 *
 * The repository root is the outermost thing that is still "the project": it is checked, and the
 * walk ends there — which is what lets a monorepo keep one config its packages share, while a
 * package's own still wins by being found first. A project that is not a repository stops before
 * the home directory instead, which is the case this exists for.
 *
 * A directory under `node_modules` is skipped whole: a dependency's own file is not this project's
 * settings, whatever it holds.
 */
export function findConfig(from: string): string | undefined {
  const home = homedir();
  let directory = from;

  for (;;) {
    if (directory === home) return undefined;

    if (!directory.split(sep).includes("node_modules")) {
      const candidate = join(directory, "ramonda.css.ts");
      if (existsSync(candidate)) return candidate;
    }

    // Checked AFTER the candidate, so a repository's own root config is still found.
    if (existsSync(join(directory, ".git"))) return undefined;

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

  validate(config as Record<string, unknown>, path);
  return config as Config;
}

/**
 * The VALUES, which used to be a cast and nothing else.
 *
 * A review traced where an unchecked value lands, and it is not a diagnostic: `units: "px"` reaches
 * `allowed.map` in `rules.ts` and throws a `TypeError` from inside the editor's
 * `getScriptSnapshot` — which tsserver calls for every file in the program, so **one wrong value in
 * one config takes down completion, hover and every squiggle in the whole project**, on every
 * keystroke, because the cache is written after the throw. The build dies with a stack naming
 * neither the file nor the key.
 *
 * Nothing types this file: the documented example is a bare object literal, and `units: "px"` is
 * the obvious thing to write when the list has one entry. So the value is checked here, where the
 * message can name the file and say what to write instead — which is the same standard the key
 * check above already met.
 */
function validate(config: Record<string, unknown>, path: string): void {
  const refuse = (says: string): never => {
    throw new Error(`${path} ${says}`);
  };

  const units = config.units;
  if (units !== undefined) {
    if (!Array.isArray(units)) refuse(`sets \`units\` to ${describe(units)}. It takes a list, like ["px", "rem"].`);
    for (const one of units as unknown[]) {
      if (typeof one !== "string") refuse(`lists ${describe(one)} in \`units\`. Every unit is a string, like "px".`);
    }
  }

  const rules = config.rules;
  if (rules !== undefined) {
    if (typeof rules !== "object" || rules === null || Array.isArray(rules)) {
      refuse(`sets \`rules\` to ${describe(rules)}. It takes an object, like { "unknown-unit": "off" }.`);
    }
    for (const [id, severity] of Object.entries(rules as Record<string, unknown>)) {
      if (!(RULE_IDS as readonly string[]).includes(id)) {
        const meant = nearest(id, RULE_IDS as readonly string[]);
        refuse(`silences \`${id}\`, which is not a rule.` + (meant === undefined ? "" : ` Did you mean \`${meant}\`?`));
      }
      if (severity !== "off" && severity !== "error") {
        refuse(`sets \`${id}\` to ${describe(severity)}. A rule is "error" or "off".`);
      }
    }
  }

  const format = config.format;
  if (format !== undefined && (typeof format !== "object" || format === null || Array.isArray(format))) {
    refuse(`sets \`format\` to ${describe(format)}. It takes an object, like { indent: 2 }.`);
  }
}

/** What a wrong value IS, for a message that can be acted on without opening the source. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value === "string" ? `the string ${JSON.stringify(value)}` : `a ${typeof value}`;
}
