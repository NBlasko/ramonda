import { existsSync, readFileSync } from "node:fs";
import { RULE_IDS, nearest } from "./compiler/rules";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
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
  /**
   * Custom property names this compiler cannot see, so a `var()` reading one is not reported.
   *
   * It sees every name a block SETS, anywhere in the build — that is what makes the check exact and
   * what makes this list short. Two things it cannot see, and both are ordinary:
   *
   * - a name set by a stylesheet it does not compile — a third-party theme, a hand-written
   *   `global.css`;
   * - a name set from JavaScript, `style={{ "--row-height": … }}`, where the name is made at runtime.
   *
   * A name with a FALLBACK needs no entry: `var(--brand, #10b981)` says in CSS's own words that the
   * value may be absent, and is never reported.
   */
  readonly variables?: readonly string[];
  /** A rule's severity, by id. `"off"` silences it; `"error"` is the default for every rule. */
  readonly rules?: Readonly<Record<string, "error" | "off">>;
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
const KNOWN = new Set(["units", "variables", "rules"]);

/**
 * Keys that were a setting and are not, with the sentence that says where the answer comes from now.
 *
 * `format: { indent }` was accepted, validated, and read by NOBODY — a review found it wired to
 * nothing, so a project that set it was told nothing and got two spaces. Wiring it up would have
 * been the wrong repair: `ramonda-css format` runs the project's own formatter and puts the block
 * back at the indentation that tool chose, and how wide a level is has already been said to that
 * tool. A second place to say it could only ever disagree with the first.
 *
 * Named rather than merely unknown, because somebody who wrote it was told it was a setting.
 */
const DECIDED_ELSEWHERE = new Map([
  [
    "format",
    "how a block is laid out is your formatter's decision, not a setting here — `ramonda-css format` " +
      "runs your own biome or prettier and puts the block back at the indentation it chose, one level " +
      "in being as wide as it is everywhere else in the file",
  ],
]);

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
  return load(path, textOf(path), typescript, environment);
}

/** A config that cannot be READ says so with its own name in the message, the same as one that throws. */
function textOf(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`${path} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The settings that govern a FILE — one answer to the question three consumers each answered their
 * own way.
 *
 * ## Why the file, and not a directory
 *
 * A review found one setting read from three roots: `check.ts` walked up from the tsconfig's
 * directory, `vite.ts` and `esbuild.ts` from `process.cwd()`, and the editor from
 * `host.getCurrentDirectory()`. In a monorepo those are three different files for one source file —
 * so the units the editor squiggles against need not be the units the build enforces, and which one
 * an author meets depends on where they typed a command. The ninth occurrence of the repository's
 * recurring fault: one rule, many consumers, and nothing making them agree.
 *
 * The file being compiled is the only anchor that is a property of the work rather than of the
 * shell, so it is the anchor. Every consumer passes the file it is holding.
 *
 * ## Why the cache is keyed on the config's own text
 *
 * The other half of the same finding: `vite.ts` and `esbuild.ts` read the config once when the
 * plugin was constructed and never again, so a dev server kept compiling the settings it booted
 * with while the editor — which re-reads per pass — had already moved on. One file, two tools, two
 * answers, and the author is told the build agrees with the editor.
 *
 * Keyed on the TEXT, that cannot happen and there is no hook to remember to call: a changed config
 * is a changed key, a config written after the process started is found by the same walk as any
 * other, and a deleted one goes back to the empty config. What is paid per file is an `existsSync`
 * walk and a read of a file measured in tens of lines; the transpile and the `new Function` — which
 * are the cost — happen once per thing the config says.
 *
 * Measured, five directories deep, 2000 files: **39 µs a file** against **253 µs** for reading it
 * afresh each time, and of those 39 the walk is 20 and the read 13. So the cache pays for itself six
 * times over, and what is left is stat calls. Caching the WALK too would take most of the rest, and
 * it is deliberately not done: a directory already asked about would never notice a config written
 * into it, which is precisely the staleness this exists to remove.
 *
 * The environment is a FUNCTION for the same reason the read is lazy. Vite constructs a plugin
 * before any hook runs and only says which build this is in `config`, so a reader that captured the
 * answer when it was made would capture the one nobody had yet.
 */
export function configReader(
  typescript: typeof ts,
  environment: ConfigEnvironment | (() => ConfigEnvironment) = {},
): (file: string) => Config {
  /** By the config's path, holding what it said and the exact text and environment it said it for. */
  const cache = new Map<string, { source: string; asked: string; config: Config }>();

  return (file: string): Config => {
    const path = findConfig(dirname(resolve(file)));
    if (path === undefined) return EMPTY;

    const source = textOf(path);
    const environmentNow = typeof environment === "function" ? environment() : environment;
    const asked = JSON.stringify(environmentNow);

    const had = cache.get(path);
    if (had !== undefined && had.source === source && had.asked === asked) return had.config;

    // Not cached: a config that throws must throw for every file, not for the first one only.
    const config = load(path, source, typescript, environmentNow);
    cache.set(path, { source, asked, config });
    return config;
  };
}

/** One frozen object for every file with no config above it, so nobody can write into a shared answer. */
const EMPTY: Config = Object.freeze({});

/**
 * The same read, given the text rather than fetching it — which is what lets {@link configReader}
 * decide whether anything has changed before paying for a transpile.
 */
function load(path: string, source: string, typescript: typeof ts, environment: ConfigEnvironment): Config {
  let exported: unknown;
  try {
    const javascript = typescript.transpileModule(source, {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2022,
        /**
         * Without it, `import path from "node:path"` — which is how a default import is written and
         * how every editor completes one — becomes `path_1.default` against a module that has no
         * `default`, and the config dies on `Cannot read properties of undefined`. A review found
         * it. The interop helper is emitted into the transpiled text, so nothing has to be
         * available at runtime for it to work.
         */
        esModuleInterop: true,
      },
      fileName: path,
    }).outputText;

    const holder: { exports: Record<string, unknown> } = { exports: {} };
    const require = createRequire(path);
    /**
     * `__dirname` and `__filename` are handed over because this text IS CommonJS by the time it
     * runs, and `new Function` supplies only what it is given. A config resolving a path against
     * its own directory — a token list beside it, say — threw `__dirname is not defined`, which
     * names the symptom and not one thing an author could act on.
     */
    new Function("module", "exports", "require", "__dirname", "__filename", javascript)(
      holder,
      holder.exports,
      require,
      dirname(path),
      path,
    );
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

  /**
   * **An `async` config was silently ignored**, and `async` is what somebody writes the moment the
   * config reads anything — a token list beside it, which is the shape `__dirname` exists here for.
   *
   * A Promise is an object, so the check above let it through; `Object.keys` of one is empty, so
   * every validation below passed over nothing; and what came back was the empty config. Measured:
   * `export default async () => ({ units: ["px"] })` enforced no units and said nothing — the exact
   * failure the note on {@link readConfig} refuses, "a tool that quietly ran with defaults because
   * somebody's config had a typo".
   *
   * It cannot be awaited instead. The editor asks for a config inside `getScriptSnapshot`, which is
   * synchronous, so a reader that returned a promise there would have to be a SECOND reader — and
   * one rule with two readers is this repository's recurring fault. So it is refused, with the one
   * thing the author can do about it.
   */
  if (typeof (config as { then?: unknown }).then === "function") {
    throw new Error(
      `${path} is async, and a config cannot be — the editor asks for it synchronously, so there is ` +
        `nowhere to await it. Read what you need at the top level, or move the work into the value: ` +
        `\`export default { units: readFileSync(join(__dirname, "units.json"), "utf8").split(",") }\`.`,
    );
  }

  for (const key of Object.keys(config)) {
    if (IDENTITY.has(key)) {
      throw new Error(
        `${path} sets \`${key}\`, which decides a block's IDENTITY and cannot be a project setting. ` +
          `Two packages naming one block differently would emit two rules for it, with nothing to ` +
          `notice — see CONTRACT.md §3. Class names are chosen by the bundler plugin, per build.`,
      );
    }
    const elsewhere = DECIDED_ELSEWHERE.get(key);
    if (elsewhere !== undefined) {
      throw new Error(`${path} sets \`${key}\`, and ${elsewhere}.`);
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

  const variables = config.variables;
  if (variables !== undefined) {
    if (!Array.isArray(variables)) {
      refuse(`sets \`variables\` to ${describe(variables)}. It takes a list, like ["--brand"].`);
    }
    for (const one of variables as unknown[]) {
      if (typeof one !== "string") {
        refuse(`lists ${describe(one)} in \`variables\`. Every name is a string, like "--brand".`);
      }
      if (!(one as string).startsWith("--")) {
        refuse(`lists \`${one}\` in \`variables\`. A custom property begins with two dashes, like "--brand".`);
      }
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
}

/** What a wrong value IS, for a message that can be acted on without opening the source. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value === "string" ? `the string ${JSON.stringify(value)}` : `a ${typeof value}`;
}
