import { existsSync, readFileSync } from "node:fs";
import { type Declarations, namesIn } from "./codegen";
import { KINDS } from "./declared";
import { PROPERTIES, UNIT_TYPE } from "./compiler/keywords.generated";
import type { Kind } from "./token";
import type { CssArity, CssProperties, CssShorthand } from "./properties.generated";
import type { CssUnit, CssUnitFamily } from "./units.generated";
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
   * The units a value may use, **by family** — a family not named here is not constrained.
   *
   * ```ts
   * units: { length: ["px", "rem"] }            // lengths are these two; times, angles untouched
   * units: { length: ["px"], time: ["ms"] }     // two families, said separately
   * units: { flex: [] }                         // `fr` is not used in this project at all
   * ```
   *
   * A project rule rather than a CSS one: `em` is valid CSS and a team may still have decided
   * against it. Absent, every unit CSS has is fine.
   *
   * **Keyed by family because a flat list could not say what anybody meant.** `units: ["px", "rem"]`
   * was this key, and it meant *every unit in CSS and nothing else* — so measured, a project stating
   * the one rule it wanted got four reports on ordinary CSS it had no opinion about:
   *
   *     transition: all 200ms ease      ms is a time
   *     width: 50%                      % is a percentage
   *     rotate: 45deg                   deg is an angle
   *     grid-template-columns: 1fr      fr is a flex
   *
   * To say "lengths are px and rem" you had to enumerate the units of five other families. The
   * families come from `UNIT_TYPE`, generated with an assertion that every unit lands in exactly
   * one, so a unit CSS adds fails the build until somebody classifies it.
   *
   * **This is the project-wide sweep, and it is read by a RULE.** Its namesake inside
   * {@link PropertyRule} is a different thing wearing the same word: that one is per property and
   * reaches the TYPES, so it can only bind a property whose value is a dimension. This one reads
   * every value in every block, including the ones no type describes — `transition`, `rotate`,
   * `grid-template-columns`. Neither can do the other's job, which is why both exist.
   */
  readonly units?: UnitsByFamily;
  /**
   * The variables this project DECLARES — a name, a kind and a fallback each.
   *
   * ```ts
   * variables: {
   *   color: kind("color",  { primary: { main: "#3b82f6" } }),
   *   size:  kind("length", { control: { md: "30px" } }),
   * }
   * ```
   *
   * Codegen writes the `:root` that sets them and the `@property` that registers each one, so a
   * project does not write either. That is what makes the fallback ONE value used twice rather than
   * a number kept in step by hand.
   *
   * `$.color.primary.main` in a block then compiles to `var(--color-primary-main)`, and a path
   * naming nothing here is reported — see the `unknown-variable` rule, which is the only thing
   * standing between a typo and a `var()` into a name nothing sets.
   */
  readonly variables?: Declarations;
  /**
   * Custom property names this compiler cannot see, so a `var()` reading one is not reported.
   *
   * It sees every name a block SETS, anywhere in the build, and every name {@link variables}
   * declares — that is what makes the check exact and what makes this list short. Two things it
   * cannot see, and both are ordinary:
   *
   * - a name set by a stylesheet it does not compile — a third-party theme, a hand-written
   *   `global.css`;
   * - a name set from JavaScript, `style={{ "--row-height": … }}`, where the name is made at runtime.
   *
   * A name with a FALLBACK needs no entry: `var(--brand, #10b981)` says in CSS's own words that the
   * value may be absent, and is never reported.
   *
   * **This was `variables` until that key became the declarations.** `DESIGN.md` has it growing a
   * reader — a function returning `{ name, value, where }`, so a project's own theme file can be
   * checked rather than trusted — and a plain list of names is the first form of it.
   */
  readonly alsoSets?: readonly string[];
  /**
   * How strict this project is about each property — what codegen turns into its own types.
   *
   * ```ts
   * properties: {
   *   "*": { shorthand: false, arity: 1 },
   *   margin: { shorthand: true, arity: 4 },
   *   "z-index": { values: [1, 2, 5, 10] },
   * }
   * ```
   *
   * **One map keyed by property, with `"*"` as the sweep.** `DESIGN.md` weighs this against three
   * other designs; what settled it is the merge — two shared configs combine key by key, and a
   * project overrides one property without disturbing the rest, which is what makes a config
   * somebody else wrote worth starting from.
   *
   * Every constraint reaches BOTH the types and the completions, because codegen writes the property
   * map this project's blocks are checked against. That is the whole reason it is here rather than
   * shipped: what CSS allows is this package's to state, and how far a project goes is not.
   */
  readonly properties?: PropertyRules;
  /**
   * Where `ramonda-css codegen` writes, relative to this file. `"css-system"` unless said.
   *
   * ```ts
   * outDir: "design-system",
   * ```
   *
   * The folder holds `index.ts` — the `$` object, `Value`, `Var` and this project's narrowed
   * property map — and `variables.css`, which sets them. Both are meant to be COMMITTED: they are
   * codegen output like any other, and this repository's own `keywords.generated.ts` is committed
   * with a gate catching drift, which is what prevents drift rather than hiding the file.
   *
   * A name is offered because a project may already have a folder called `css-system`, and a
   * generated one silently landing beside it is worse than a key. It is read from this file's TEXT
   * by the per-file lookups, which run on every keystroke's worth of work in an editor — so it has
   * to be a plain string literal there, and a computed one falls back to the default for those.
   */
  readonly outDir?: string;
  /** A rule's severity, by id. `"off"` silences it; `"error"` is the default for every rule. */
  readonly rules?: Readonly<Record<string, "error" | "off">>;
}

/**
 * Every custom property name a `var()` in this project may read without being reported.
 *
 * Two sources and one answer, because there are three callers — the checker and both bundlers — and
 * a name known to one of them and not the others would be a report in `ramonda-css check` that the
 * build does not make, or the reverse.
 *
 * - what {@link Config.variables} DECLARES, which codegen also writes into the stylesheet;
 * - what {@link Config.alsoSets} names, which is everything this compiler cannot see.
 *
 * The first of those is why declaring a variable no longer means writing its name twice: a name that
 * is declared is a name `var()` may read, and nothing has to say so a second time.
 */
export function knownNames(config: Config): readonly string[] {
  const declared = config.variables === undefined ? [] : namesIn(config.variables).map((one) => one.name);
  return [...declared, ...(config.alsoSets ?? [])];
}

/**
 * What {@link Config.units} is — the permitted units of a family, for the families a project names.
 *
 * Its own name because three consumers hold it: the rule that reads it, the config validator that
 * refuses the old flat form, and this interface.
 */
export type UnitsByFamily = Readonly<Partial<Record<CssUnitFamily, readonly CssUnit[]>>>;

/** The unit families, derived from the table rather than written twice. */
const UNIT_FAMILIES: ReadonlySet<string> = new Set(Object.values(UNIT_TYPE));

/** Every property name, and the wildcard that reaches all of them at once. */
type PropertyName = keyof CssProperties;

/**
 * What a project may say about ONE property, with each key ABSENT where it means nothing.
 *
 * The absences are the type's work, and the shape is an intersection of the parts that apply rather
 * than a mapped type with `never` keys — measured, and the difference is the whole message:
 *
 *     never key    Type 'false' is not assignable to type 'undefined'
 *     absent key   TS2353: 'shorthand' does not exist in type …
 *
 * The first tells a reader nothing; it names `undefined`, which is not what they wrote or meant. The
 * second says the key cannot be there, which is the fact. So `shorthand` exists on the 98 names the
 * engines call shorthands and nowhere else, and `arity` is bounded by what CSS itself gives —
 * `padding: { arity: 7 }` is refused by the number, not by a rule of ours.
 */
export type PropertyRule<P extends PropertyName | "*" | KindSelector = PropertyName | "*" | KindSelector> = (P extends
  | CssShorthand
  | "*"
  | KindSelector
  ? {
      /**
       * Whether this shorthand exists at all. `false` removes it, so a project writes `padding-left`.
       *
       * On `"*"` it removes every shorthand at once, and naming one with `true` brings that back.
       */
      readonly shorthand?: boolean;
    }
  : unknown) &
  (P extends keyof CssArity
    ? {
        /**
         * How many values this property may take, at most — bounded by what CSS itself gives.
         *
         * Only the sixteen that repeat one longhand: `padding`, `margin`, `inset` and their block
         * and inline pairs. A shorthand whose parts are different things has no count worth picking.
         */
        readonly arity?: CssArity[P];
      }
    : P extends "*" | KindSelector
      ? { readonly arity?: 1 | 2 | 3 | 4 }
      : unknown) & {
    /** The units a value here may carry. Everything else is refused. */
    readonly units?: readonly CssUnit[];
    /** The only values this property may take — `z-index: [1, 2, 5, 10]`. A closed list. */
    readonly values?: readonly (string | number)[];
    /**
     * Whether a value here may only be a declared VARIABLE, never a literal.
     *
     * ```ts
     * "<color>": { variablesOnly: true },      // no colour is written out anywhere
     * "border":  { variablesOnly: false },     // except in this one
     * ```
     *
     * Asked for by the user, in their words: *"za boje moze reci da hoce samo kroz tokene i
     * variable da radi, nece hardcoded values."* A closed list of every permitted colour is not
     * that — a palette is fifty values that change, and pinning them in a property's type puts it
     * in two places.
     *
     * **Usually written on a KIND**, because a colour reaches 40 properties and a length 127.
     * Written on a property it is the exemption, which is the thing the old top-level list could
     * not express.
     *
     * Two machineries answer it and both are needed. A property that says what it takes is narrowed
     * by its TYPE, which is exact. A composite one — `border-left: 4px solid red` — has no type
     * worth narrowing, and the `literal-not-allowed` rule reads its value instead.
     *
     * `currentcolor`, a bare `0`, the CSS-wide keywords and `var()` all still go in: none of them is
     * a value somebody hardcoded, and refusing them would be refusing what CSS itself provides.
     */
    readonly variablesOnly?: boolean;
  };

/**
 * A KIND, written the way CSS writes a type — `"<length>"`, `"<color>"`.
 *
 * The middle selector. It reaches every property whose value IS that kind, which is what makes a
 * setting like `variablesOnly` sayable at all: a colour reaches 40 properties and a length 127, and
 * nobody is going to list them.
 *
 * Not a vocabulary of ours. `<length>` is the same word already written in `kind("length", …)` and
 * registered in `@property { syntax }`, so a project that has declared a variable has already used
 * it. The angle brackets are CSS's own notation for a type and keep it apart from a property name.
 *
 * A kind matches a property through the SAME table the narrowing uses, so `"<length>"` reaches
 * `padding-left`, whose grammar is `<length-percentage>`. A project saying *lengths* means lengths.
 */
export type KindSelector = `<${Kind}>`;

/**
 * The map, keyed by three things: every property, every property of a kind, and one property.
 *
 * ```ts
 * properties: {
 *   "*":             { shorthand: false },      // every property
 *   "<length>":      { variablesOnly: true },   // every property whose value is a length
 *   "border-radius": { variablesOnly: false },  // this one, overriding the kind
 * }
 * ```
 *
 * **In that order, each binding more tightly than the one before**, which is the same shape CSS
 * itself has and the reason the selectors are spelled the way they are. See {@link rulesFor} for
 * the merge, which is key by key so two shared configs still combine.
 *
 * `"*"` was the only selector, and `variablesOnly` was a top-level key listing kinds — the one
 * setting keyed by kind while every other was keyed by property. Asked by the user, whose worry was
 * the config growing: this is one key fewer at the top, and it gains the exemption the top-level
 * list could not express.
 */
export type PropertyRules = { readonly [P in PropertyName | "*" | KindSelector]?: PropertyRule<P> };

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
const KNOWN = new Set(["units", "variables", "alsoSets", "properties", "outDir", "rules"]);

/** Keys that were a setting and are one somewhere ELSE now. `validate` writes out where. */
const MOVED = new Set(["variablesOnly"]);

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
/**
 * A config this cannot use, said rather than thrown.
 *
 * Every way `ramonda.css.ts` can be wrong already had a careful sentence — a rule id that is not one,
 * with a *did you mean*; an async config; `units` as a string. Measured, all of them reached a person
 * as a Node crash: `throw new Error(…)`, a caret, and a stack. The words were right and the shape was
 * a failure of the tool rather than a fault in their file.
 *
 * Its own class so the CLI can tell it from a bug of ours, which is the same distinction `ToolFailed`
 * draws for a tool that would not run — and for the same reason: one of those is the author's to fix
 * and the other is not.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function readConfig(
  path: string | undefined,
  typescript: typeof ts,
  environment: ConfigEnvironment = {},
): Config {
  if (path === undefined) return {};
  return load(path, textOf(path), typescript, environment);
}

/**
 * A config the parser could not read, said with the place and with what the silence would have cost.
 *
 * Its own function because the sentence is the whole point: a parse error is the one fault where
 * doing nothing looks exactly like success, so the message has to say that the settings would have
 * been dropped rather than only that a brace is missing.
 */
function doesNotParse(path: string, source: string, first: ts.Diagnostic, typescript: typeof ts): string {
  const file = typescript.createSourceFile(path, source, typescript.ScriptTarget.ES2022, true);
  const at =
    first.start === undefined
      ? ""
      : (({ line, character }) => `:${line + 1}:${character + 1}`)(
          typescript.getLineAndCharacterOfPosition(file, first.start),
        );

  return (
    `${path}${at} does not parse: TS${first.code}: ` +
    `${typescript.flattenDiagnosticMessageText(first.messageText, " ")}\n\n` +
    "        TypeScript recovers from this and hands back whatever it could build — which is an\n" +
    "        EMPTY config that loads cleanly. Every setting in this file would be dropped in\n" +
    "        silence, and the build would ship without them."
  );
}

/** A config that cannot be READ says so with its own name in the message, the same as one that throws. */
function textOf(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigError(`${path} could not be read: ${error instanceof Error ? error.message : String(error)}`);
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
    const transpiled = typescript.transpileModule(source, {
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
      /**
       * Asked for, because TypeScript's error RECOVERY hides a broken config completely.
       *
       * `transpileModule` reports nothing unless this is set, and it emits whatever it managed to
       * build from the wreckage. Measured:
       *
       *     export default { variables: {{{ };     →     exports.default = { variables: {} };
       *
       * So the config LOADED — valid, empty, and nobody's. Nothing threw and nothing was undefined,
       * so every consumer that does not type-check `ramonda.css.ts` ran with no settings at all: a
       * real Vite build exited 0 and shipped `.r-pl-2rem` and `.r-c-#ff0000`, the unit and the
       * hardcoded colour that very config forbids. Only `ramonda-css check` caught it, because it
       * alone type-checks the file.
       *
       * The note above {@link readConfig} names this exact failure — *a tool that quietly ran with
       * defaults because somebody's config had a typo* — so it is refused here, where every
       * consumer goes through.
       *
       * Syntactic diagnostics only, which is the right severity: this says the file does not PARSE,
       * never that a value has the wrong type. Measured clean on every valid config in this
       * repository and on four more shapes, including `as const`, a type annotation, and one
       * reading a file beside itself.
       */
      reportDiagnostics: true,
    });

    const [broken] = transpiled.diagnostics ?? [];
    if (broken !== undefined) throw new ConfigError(doesNotParse(path, source, broken, typescript));

    const javascript = transpiled.outputText;

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
    // A `ConfigError` raised in there is already the sentence this would write, with the place in
    // it — wrapping it again reads as two faults: `could not be read: … does not parse: …`.
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`${path} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (exported === undefined) {
    throw new ConfigError(`${path} has no default export — write \`export default { … }\`.`);
  }

  const config =
    typeof exported === "function" ? (exported as (env: ConfigEnvironment) => unknown)(environment) : exported;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new ConfigError(`${path} must export an object, or a function returning one.`);
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
    throw new ConfigError(
      `${path} is async, and a config cannot be — the editor asks for it synchronously, so there is ` +
        `nowhere to await it. Read what you need at the top level, or move the work into the value: ` +
        `\`export default { units: readFileSync(join(__dirname, "units.json"), "utf8").split(",") }\`.`,
    );
  }

  for (const key of Object.keys(config)) {
    if (IDENTITY.has(key)) {
      throw new ConfigError(
        `${path} sets \`${key}\`, which decides a block's IDENTITY and cannot be a project setting. ` +
          `Two packages naming one block differently would emit two rules for it, with nothing to ` +
          `notice — see CONTRACT.md §3. Class names are chosen by the bundler plugin, per build.`,
      );
    }
    const elsewhere = DECIDED_ELSEWHERE.get(key);
    if (elsewhere !== undefined) {
      throw new ConfigError(`${path} sets \`${key}\`, and ${elsewhere}.`);
    }
    /**
     * A key that MOVED is refused by `validate`, which can read its value and write the replacement.
     *
     * Skipped here rather than listed in `KNOWN`, because it is not a setting any more and saying
     * so generically — *"which is not a setting"* — would lose the one thing its author needs,
     * which is where it went.
     */
    if (MOVED.has(key)) continue;
    if (!KNOWN.has(key)) {
      throw new ConfigError(`${path} sets \`${key}\`, which is not a setting. It holds ${[...KNOWN].join(", ")}.`);
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
/** Every CSS property name, as a set, for the `properties` keys. */
const PROPERTY_NAMES = new Set(PROPERTIES);

/**
 * The settings INSIDE one `properties` entry, which the validation used to stop short of.
 *
 * The note above {@link validate} traced where an unchecked value lands and refused to leave it
 * there: a `TypeError` thrown out of `getScriptSnapshot` takes down completion, hover and every
 * squiggle in the project, on every keystroke. That reasoning was applied to the top-level keys and
 * not one level down — and measured, the same two keys land in the same place:
 *
 *     properties: { "<length>": { units: { length: ["px"] } } }
 *     → TypeError: units.map is not a function, with a stack naming neither the file nor the key
 *
 * `units` is the sharp one. The TOP-LEVEL key changed to be keyed by FAMILY and says so when a list
 * arrives; per property it is still a list, because one property has one set of units and no family
 * to disambiguate. So an author who learns the top-level lesson and applies it here was thanked
 * with a crash. The message below says which shape belongs where.
 *
 * The other three were not crashes, which is worse in its own way: `shorthand: "no"`,
 * `variablesOnly: "yes"` and a key that is not a setting at all were accepted in silence and did
 * nothing — a rule the author believes they wrote and nobody enforces.
 */
function settings(key: string, entry: unknown, refuse: (says: string) => never): void {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    refuse(
      `sets \`properties[${JSON.stringify(key)}]\` to ${describe(entry)}. It takes settings, like { shorthand: false }.`,
    );
  }

  const known = ["units", "values", "shorthand", "variablesOnly", "arity"];
  for (const [name, value] of Object.entries(entry as Record<string, unknown>)) {
    const at = `properties[${JSON.stringify(key)}].${name}`;
    if (!known.includes(name)) {
      const meant = nearest(name, known);
      refuse(
        `sets \`${at}\`, which is not a setting.` +
          (meant === undefined ? "" : ` Did you mean \`${meant}\`?`) +
          ` An entry holds ${known.join(", ")}.`,
      );
    }

    if (name === "units") {
      if (!Array.isArray(value)) {
        refuse(
          `sets \`${at}\` to ${describe(value)}. Per property it is a LIST, like ["px", "rem"] — ` +
            `one property has one set of units.\n\n        The families are for the top-level ` +
            `\`units\`, which covers every property at once: units: { length: ["px"] }.`,
        );
      }
      for (const one of value as unknown[]) {
        if (typeof one !== "string") refuse(`lists ${describe(one)} in \`${at}\`. Every unit is a string, like "px".`);
      }
    }

    if (name === "values") {
      if (!Array.isArray(value)) {
        refuse(`sets \`${at}\` to ${describe(value)}. It takes a closed list, like [0, 1, 10].`);
      }
      for (const one of value as unknown[]) {
        if (typeof one !== "string" && typeof one !== "number") {
          refuse(`lists ${describe(one)} in \`${at}\`. Every value is a string or a number.`);
        }
      }
    }

    if ((name === "shorthand" || name === "variablesOnly") && typeof value !== "boolean") {
      refuse(`sets \`${at}\` to ${describe(value)}. It is true or false.`);
    }

    if (name === "arity" && (typeof value !== "number" || ![1, 2, 3, 4].includes(value))) {
      refuse(`sets \`${at}\` to ${describe(value)}. It is how many values go in: 1, 2, 3 or 4.`);
    }
  }
}

function validate(config: Record<string, unknown>, path: string): void {
  const refuse = (says: string): never => {
    throw new ConfigError(`${path} ${says}`);
  };

  const units = config.units;
  if (units !== undefined) {
    /**
     * A LIST is the old spelling, and it MUST be refused rather than reinterpreted.
     *
     * `units: ["px", "rem"]` meant every unit in CSS and nothing else; keyed by family the same
     * words mean lengths only. Accepting the list and reading it as `{ length: [...] }` would be a
     * project's rules quietly getting weaker on an upgrade — `200ms` and `45deg` stop being reported
     * and nothing says so. A config that stops loading is a minute's work; a check that stops
     * checking is found in production.
     */
    if (Array.isArray(units)) {
      refuse(
        `sets \`units\` to a list. That was its old meaning — every unit in CSS and nothing else — ` +
          `and it is keyed by FAMILY now, so a family you do not name is not constrained.\n\n` +
          `        units: { length: ${JSON.stringify(units)} }\n\n` +
          `        The list form reported \`200ms\`, \`50%\`, \`45deg\` and \`1fr\` as faults, which is ` +
          `why it changed.`,
      );
    }
    if (typeof units !== "object" || units === null) {
      refuse(`sets \`units\` to ${describe(units)}. It takes families, like { length: ["px", "rem"] }.`);
    }
    for (const [family, list] of Object.entries(units as Record<string, unknown>)) {
      if (!UNIT_FAMILIES.has(family)) {
        const meant = nearest(family, [...UNIT_FAMILIES]);
        refuse(
          `keys \`units\` by \`${family}\`, which is not a unit family.` +
            (meant === undefined ? "" : ` Did you mean \`${meant}\`?`) +
            ` The families are ${[...UNIT_FAMILIES].sort().join(", ")}.`,
        );
      }
      if (!Array.isArray(list)) {
        refuse(`sets \`units.${family}\` to ${describe(list)}. It takes a list, like ["px", "rem"].`);
      }
      for (const one of list as unknown[]) {
        if (typeof one !== "string") {
          refuse(`lists ${describe(one)} in \`units.${family}\`. Every unit is a string, like "px".`);
        }
      }
    }
  }

  const variables = config.variables;
  if (variables !== undefined) {
    /**
     * A LIST here is the old spelling, and it is worth saying so rather than describing the shape.
     *
     * `variables: ["--brand"]` was this key until the declarations took it, and a project carrying
     * the old form would otherwise be told only that an object was expected — true, and no help at
     * all about where its list should go now.
     */
    if (Array.isArray(variables)) {
      refuse(
        `sets \`variables\` to a list. That was its old meaning — names this compiler cannot see — ` +
          `and those go in \`alsoSets\` now.\n\n` +
          `        \`variables\` declares what this project OWNS, with a kind and a fallback each:\n` +
          `        variables: { color: kind("color", { primary: { main: "#3b82f6" } }) }`,
      );
    }
    if (typeof variables !== "object" || variables === null) {
      refuse(`sets \`variables\` to ${describe(variables)}. It takes groups made with \`kind( … )\`.`);
    }
  }

  const alsoSets = config.alsoSets;
  if (alsoSets !== undefined) {
    if (!Array.isArray(alsoSets)) {
      refuse(`sets \`alsoSets\` to ${describe(alsoSets)}. It takes a list, like ["--brand"].`);
    }
    for (const one of alsoSets as unknown[]) {
      if (typeof one !== "string") {
        refuse(`lists ${describe(one)} in \`alsoSets\`. Every name is a string, like "--brand".`);
      }
      if (!(one as string).startsWith("--")) {
        refuse(`lists \`${one}\` in \`alsoSets\`. A custom property begins with two dashes, like "--brand".`);
      }
    }
  }

  /**
   * The old top-level key, refused with the kind selector written out.
   *
   * `variablesOnly: ["color"]` was a list of kinds at the top of the config, which made it the one
   * setting keyed by kind while every other was keyed by property. It is a selector inside
   * `properties` now — same reach, one key fewer, and a property may exempt itself.
   *
   * Named rather than merely unknown, because somebody who wrote it was told it was a setting. The
   * replacement is mechanical, so the message writes it.
   */
  const variablesOnly = config.variablesOnly;
  if (variablesOnly !== undefined) {
    const kinds = Array.isArray(variablesOnly)
      ? (variablesOnly as unknown[]).filter((one) => typeof one === "string")
      : [];
    const written = (kinds.length === 0 ? ["color"] : kinds).map(
      (one) => `          "<${one}>": { variablesOnly: true },`,
    );
    refuse(
      `sets \`variablesOnly\`, which is a selector inside \`properties\` now — same reach, and a ` +
        `property may exempt itself from it:\n\n        properties: {\n${written.join("\n")}\n        },`,
    );
  }

  const properties = config.properties;
  if (properties !== undefined) {
    if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
      refuse(`sets \`properties\` to ${describe(properties)}. It takes a map keyed by property.`);
    }
    for (const key of Object.keys(properties as Record<string, unknown>)) {
      /**
       * A closed list on the SWEEP, refused rather than quietly doing nothing.
       *
       * `"*": { values: [...] }` is expressible and meant nothing: a list of permitted values for
       * all 935 properties is not a thing anybody intends, and the one property it would be right
       * for is named. It was silently skipped until a review asked what it did.
       */
      if (key === "*" && (properties as Record<string, { values?: unknown }>)[key]?.values !== undefined) {
        refuse(
          'sets `values` on `"*"`, which cannot mean anything — a closed list of permitted values ' +
            "belongs to ONE property, or to a kind:\n\n" +
            '        "z-index": { values: [0, 1, 10] },\n' +
            '        "<time>": { values: ["120ms", "400ms"] },',
        );
      }
      const kind = /^<(.+)>$/.exec(key);
      if (kind !== null) {
        if (!KINDS.includes(kind[1] as never)) {
          const meant = nearest(kind[1], KINDS as readonly string[]);
          refuse(
            `keys \`properties\` by \`${key}\`, which is not a kind.` +
              (meant === undefined ? "" : ` Did you mean \`<${meant}>\`?`) +
              ` The kinds are CSS's own: ${KINDS.join(", ")}.`,
          );
        }
      } else if (key !== "*" && !PROPERTY_NAMES.has(key) && !key.startsWith("--")) {
        /**
         * A misspelled PROPERTY NAME, which was silent while a misspelled KIND was refused.
         *
         * Two halves of one key disagreeing: `"<lenght>"` stopped the config and `"padding-lft"`
         * was accepted and did nothing at all. That is the failure {@link readConfig}'s own note
         * refuses — a tool quietly running with defaults because somebody's config had a typo.
         */
        const meant = nearest(key, PROPERTIES);
        refuse(
          `keys \`properties\` by \`${key}\`, which is not a CSS property.` +
            (meant === undefined ? "" : ` Did you mean \`${meant}\`?`) +
            ` A key is a property, a kind like \`"<length>"\`, or \`"*"\`.`,
        );
      }

      settings(key, (properties as Record<string, unknown>)[key], refuse);
    }
  }

  const outDir = config.outDir;
  if (outDir !== undefined) {
    if (typeof outDir !== "string" || outDir === "") {
      refuse(`sets \`outDir\` to ${describe(outDir)}. It takes a folder name, like "css-system".`);
    }
    // A path that climbs out or starts at the root writes somewhere the config does not own.
    if (/^[/\\]|^[A-Za-z]:|(^|[/\\])\.\.([/\\]|$)/.test(outDir as string)) {
      refuse(
        `sets \`outDir\` to \`${outDir}\`, which leaves this project.\n\n        It is a folder ` +
          `beside \`ramonda.css.ts\`, like "css-system" or "src/css-system".`,
      );
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
      if (severity === "off") {
        const turnedOn = whatTurnedOn(id, config);
        if (turnedOn !== undefined) {
          refuse(
            `silences \`${id}\`, which this config turned on itself with \`${turnedOn.setting}\`.` +
              `\n\n        \`rules\` is for a report you did not ask for. This one you did, and ` +
              `silencing it\n        would not even lift it — the same constraint reaches the TYPES, ` +
              `which no rule\n        severity can reach. Change the setting instead:\n\n` +
              `        ${turnedOn.instead}`,
          );
        }
      }
    }
  }
}

/**
 * The setting that turned a rule on, when the project's own config did — or nothing.
 *
 * **Three settings reach both a rule and a type, and `rules: "off"` can only silence the rule.**
 * Measured, that makes the same gesture mean two different things:
 *
 *     "*": { arity: 1 }                    too-many-values off  ->  accepted
 *     "<length>": { variablesOnly: true }  literal-not-allowed off  ->  TS2322, still refused
 *     "<length>": { units: ["px"] }        unit-not-allowed off  ->  TS2322, still refused
 *
 * So an author who silences one to ship is not unblocked: the error stays and the MESSAGE GETS
 * WORSE, because ours names the project and the config file while `Narrowed<never, Token<…>>` names
 * neither. Only `arity`, the one setting with no type behind it, silences completely.
 *
 * Refused rather than documented, because the author reaching for this has a file full of errors and
 * needs the switch that works, not a footnote. The other direction — making `off` reach the types —
 * cannot be built: codegen would have to write a narrowing and then unwrite it.
 */
function whatTurnedOn(id: string, config: Record<string, unknown>): { setting: string; instead: string } | undefined {
  const properties = (config.properties ?? {}) as Record<string, Record<string, unknown>>;
  const entries = Object.entries(properties);
  const wherever = (key: string) =>
    entries.find(([, rule]) => rule !== null && typeof rule === "object" && rule[key] !== undefined);

  if (id === "literal-not-allowed") {
    const found = entries.find(([, rule]) => rule !== null && typeof rule === "object" && rule.variablesOnly === true);
    if (found === undefined) return undefined;
    return {
      setting: `properties[${JSON.stringify(found[0])}].variablesOnly`,
      instead: `properties: { ${JSON.stringify(found[0])}: { variablesOnly: false } }`,
    };
  }

  if (id === "unit-not-allowed") {
    if (config.units !== undefined) return { setting: "units", instead: "drop `units` from ramonda.css.ts" };
    const found = wherever("units");
    if (found === undefined) return undefined;
    return {
      setting: `properties[${JSON.stringify(found[0])}].units`,
      instead: `drop \`units\` from properties[${JSON.stringify(found[0])}]`,
    };
  }

  if (id === "too-many-values") {
    const found = wherever("arity");
    if (found === undefined) return undefined;
    return {
      setting: `properties[${JSON.stringify(found[0])}].arity`,
      instead: `raise or drop \`arity\` in properties[${JSON.stringify(found[0])}]`,
    };
  }

  return undefined;
}

/** What a wrong value IS, for a message that can be acted on without opening the source. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "string") return `the string ${JSON.stringify(value)}`;
  // `an object`, not `a object` — these sentences are read by people, and `properties` is the first
  // key whose wrong value is commonly one.
  return `${/^[aeiou]/.test(typeof value) ? "an" : "a"} ${typeof value}`;
}
