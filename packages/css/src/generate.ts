import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type ts from "typescript";
import { generate, namesIn, verifyNames } from "./codegen";
import { ConfigError, findConfig, readConfig } from "./config";

/**
 * Codegen, actually run — the step that turns everything else about `$` into something a project
 * can use.
 *
 * Without this, `$.color.primary.main` parses, compiles, colours and checks, and a project still has
 * no `$` to import and no stylesheet setting the variables. Three callers need it and must agree:
 * the CLI, for CI and for the first run; and both bundler plugins, so an ordinary `dev` needs no
 * command at all.
 *
 * ## Where the files go, and why there is nothing to configure
 *
 * Beside the config, named after it:
 *
 *     ramonda.css.ts   ->   css-system/index.ts       the `$` object and its types
 *                      ->   css-system/variables.css  `:root`, and an `@property` for each
 *
 * **A folder, committed, and its name is the project's.** They were two files beside the config and
 * gitignored; the user asked for both halves — *"ja mislim da to ne treba da bude ignorisano, kao
 * sto se i ostale codegen stvari ne ignorisu"*, and the repo agrees with itself there, since
 * `keywords.generated.ts` is committed and a gate catches drift.
 *
 * `.ramonda/` was proposed and refused: a leading dot reads as *not committed*, and these are. The
 * name had to be agnostic besides — `@ramonda/css` is usable outside Ramonda, where a folder named
 * after the framework says nothing, and inside one where it says nothing either. `css-system/` is
 * the shape Panda CSS's `styled-system/` made familiar, and `outDir` renames it for a project that
 * already has something there.
 *
 * The config is already found by walking up from a file, which is what decides WHICH project a file
 * belongs to in a monorepo — so putting the output beside it means a package's own variables land in
 * that package, with no second question to answer and no setting to get wrong.
 *
 * The stylesheet is a plain file the project imports once. It could have been pushed through the
 * bundler machinery this package already has; a file is better, because it works in every bundler,
 * in none, and in a test — and because a reader can open it.
 */

/** Where the generated files go, unless a project says otherwise with `outDir`. */
export const OUT_DIR = "css-system";

/**
 * The folder a config names, read from its TEXT rather than by transpiling it.
 *
 * `propertiesFor` and `variablesSheetFor` are asked per file and must not pay for a transpile to
 * learn one string — they run inside an editor, on every keystroke's worth of work. The key is a
 * plain literal in a config people write by hand, so reading it is reading it.
 *
 * A config that computes it falls back to the default here while `writeGenerated`, which has the
 * real config, writes somewhere else — so the two readings are compared and the disagreement is
 * REFUSED. See {@link agreeOnTheFolder}: it was left to surface on its own once, and what surfaced
 * was a sentence telling the author to run a command they had just run.
 */
function outDirFor(config: string): string {
  try {
    const said = /\boutDir\s*:\s*["'`]([^"'`]+)["'`]/.exec(readFileSync(config, "utf8"));
    return said?.[1] ?? OUT_DIR;
  } catch {
    return OUT_DIR;
  }
}

/**
 * The two readings of `outDir` have to agree, and this is where the disagreement can still be said.
 *
 * Codegen has the real config and {@link outDirFor} has only the text, which is the trade that keeps
 * the per-file lookups cheap. When they differ the files land in one folder and everything that
 * reads them looks in another — and measured, what the author is shown is
 *
 *     TS2339  Property 'size' does not exist on type
 *             '"Declare your variables in ramonda.css.ts, then run `ramonda-css …`"'
 *
 * advice they have just followed. They would run it again, it would write the same two files, and
 * nothing would change. A comment that only MENTIONS the key causes it too, because the text reader
 * takes the first `outDir:` in the file.
 *
 * The note this replaces said the mismatch was *a mismatch a project can see and fix*. It was not:
 * nothing named it, and the one sentence shown was untrue.
 */
function agreeOnTheFolder(path: string, folder: string): void {
  const text = outDirFor(path);
  if (text === folder) return;

  throw new ConfigError(
    `${path} names two different folders: \`outDir\` reads as ${JSON.stringify(text)} in the file's text ` +
      `and as ${JSON.stringify(folder)} when the config runs.\n\n` +
      "        The editor and the per-file lookups read it from the TEXT — they cannot transpile a config on\n" +
      "        every keystroke — so the generated files would land where nothing looks for them.\n" +
      "        Write `outDir` as a plain string literal, and check that nothing earlier in the file spells\n" +
      "        `outDir:` first, a comment included. Nothing was written.",
  );
}

/** One file this wrote, and whether writing it changed anything. */
export interface Written {
  readonly path: string;
  /** `false` when the content was already exactly this. See {@link writeGenerated}. */
  readonly changed: boolean;
}

export interface CodegenResult {
  /** The config that was read, or `undefined` when the project has none. */
  readonly config: string | undefined;
  /** How many variables it declares. Zero is a config with other settings and no variables. */
  readonly declared: number;
  readonly files: readonly Written[];
}

/**
 * Writes only when the content DIFFERS, which is not an optimisation.
 *
 * A plugin runs codegen; codegen writes a file the bundler is watching; the write is a change; the
 * change is a rebuild; the rebuild runs the plugin. Comparing first is what ends that loop, and it
 * is the only thing that does — a timestamp would still change on an identical write.
 */
function put(path: string, text: string, write: boolean): Written {
  let already: string | undefined;
  try {
    already = readFileSync(path, "utf8");
  } catch {
    already = undefined;
  }

  if (already === text) return { path, changed: false };

  /**
   * A file at this name that is NOT ours is kept, and the run stops.
   *
   * Found by probing what each writer is willing to overwrite: this wrote straight over a
   * hand-written file and said nothing. The loss is unrecoverable, because
   * `ramonda.css.generated.*` is in `.gitignore` by this package's own instruction — there is no
   * copy to go back to.
   *
   * The name carries `generated` and the convention is plain, which is the argument for writing
   * anyway. It is the same argument `restore` refused to accept about a block a formatter had
   * eaten: an inconvenience is survivable and somebody's work is not. Looking at the target before
   * overwriting it costs one read, and the read was already happening.
   *
   * LOOSELY, on the package's name rather than the whole sentence, so a file written by an older
   * version is still ours and is still replaced.
   */
  if (already !== undefined && !already.includes("@ramonda/css")) {
    throw new ConfigError(
      `${path} was not written by this package, and codegen would overwrite it.\n\n` +
        `        That name belongs to \`ramonda-css codegen\`, which writes it from ` +
        `\`ramonda.css.ts\`.\n        Move it, rename it, or delete it — nothing was written.`,
    );
  }

  if (write) writeFileSync(path, text);
  return { path, changed: true };
}

/**
 * Runs codegen for the project that owns `from`, and writes what it produced.
 *
 * `from` is a directory or a file inside the project — the same thing {@link findConfig} takes, so a
 * plugin can hand it the file it is compiling and get that file's own config in a monorepo.
 *
 * Writes nothing at all when there is no config, or when the config declares no variables: two empty
 * files would be noise a reader has to dismiss, and the result says which case it was.
 */
export function writeGenerated(
  from: string,
  typescript: typeof ts,
  options: { readonly write?: boolean } = {},
): CodegenResult {
  const write = options.write ?? true;
  const path = findConfig(from);
  if (path === undefined) return { config: undefined, declared: 0, files: [] };

  const config = readConfig(path, typescript);
  const declarations = config.variables ?? {};
  const rules = config.properties;
  if (config.variables === undefined && rules === undefined) {
    return { config: path, declared: 0, files: [] };
  }

  /**
   * Checked before anything is written, so a collision cannot leave half a pair of files behind.
   *
   * `generate` verifies too — this is the same call, made early rather than a second rule. See
   * `verifyNames` for why the walk and the verdict are separate to begin with.
   */
  const named = namesIn(declarations);
  verifyNames(named, path);
  if (named.length === 0 && rules === undefined) {
    return { config: path, declared: 0, files: [] };
  }

  const { css, module } = generate(declarations, rules, path);
  const folder = config.outDir ?? OUT_DIR;
  agreeOnTheFolder(path, folder);
  const out = join(dirname(path), folder);
  if (write) mkdirSync(out, { recursive: true });

  return {
    config: path,
    declared: named.length,
    files: [put(join(out, "variables.css"), css, write), put(join(out, "index.ts"), module, write)],
  };
}

/** Where a file's own generated module is, once found, so the walk happens per directory. */
const beside = new Map<string, string | undefined>();

/**
 * The specifier a virtual file should import its property map FROM, for one source file.
 *
 * A project that has run codegen is checked against its OWN property map — narrowed by its config —
 * rather than against the shipped one. That map lives beside the config, so the specifier is
 * relative and differs per file, which is why this is asked per file rather than set once for a
 * project: a monorepo has a config per package, and a file belongs to the nearest one.
 *
 * `undefined` when the project has not generated one, and the caller keeps the shipped default. A
 * project with no config is not broken by this; it is simply unnarrowed, and told so once.
 */
export function propertiesFor(file: string): string | undefined {
  const directory = dirname(file);
  if (!beside.has(directory)) {
    const config = findConfig(directory);
    const module = config === undefined ? undefined : join(dirname(config), outDirFor(config), "index.ts");
    beside.set(directory, module !== undefined && existsSync(module) ? module : undefined);
  }

  const module = beside.get(directory);
  if (module === undefined) return undefined;

  /** Without the extension, and always explicitly relative — a bare `x` would be a package. */
  const path = relative(directory, module).replace(/\.ts$/, "");
  return path.startsWith(".") ? path : `./${path}`;
}

/** Forgets where the generated modules are, for a watch that has just written one. */
export function forgetGenerated(): void {
  beside.clear();
}

/**
 * The stylesheet codegen wrote for a file's project, or nothing when there is none.
 *
 * The same walk `propertiesFor` does, and for the same reason: a monorepo has a config per package
 * and a file belongs to the nearest one.
 */
export function variablesSheetFor(file: string): string | undefined {
  const config = findConfig(dirname(file));
  if (config === undefined) return undefined;

  const sheet = join(dirname(config), outDirFor(config), "variables.css");
  return existsSync(sheet) ? sheet : undefined;
}
