import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type ts from "typescript";
import { generate, namesIn, verifyNames } from "./codegen";
import { findConfig, readConfig } from "./config";

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
 *     ramonda.css.ts   ->   ramonda.css.generated.ts    the `$` object and its types
 *                      ->   ramonda.css.generated.css   `:root`, and an `@property` for each
 *
 * The config is already found by walking up from a file, which is what decides WHICH project a file
 * belongs to in a monorepo — so putting the output beside it means a package's own variables land in
 * that package, with no second question to answer and no setting to get wrong.
 *
 * The stylesheet is a plain file the project imports once. It could have been pushed through the
 * bundler machinery this package already has; a file is better, because it works in every bundler,
 * in none, and in a test — and because a reader can open it.
 */

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
function put(path: string, text: string): Written {
  let already: string | undefined;
  try {
    already = readFileSync(path, "utf8");
  } catch {
    already = undefined;
  }

  if (already === text) return { path, changed: false };

  writeFileSync(path, text);
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
export function writeGenerated(from: string, typescript: typeof ts): CodegenResult {
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
  verifyNames(named);
  if (named.length === 0 && rules === undefined) return { config: path, declared: 0, files: [] };

  const { css, module } = generate(declarations, rules);
  const beside = dirname(path);

  return {
    config: path,
    declared: named.length,
    files: [put(join(beside, "ramonda.css.generated.css"), css), put(join(beside, "ramonda.css.generated.ts"), module)],
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
    const module = config === undefined ? undefined : join(dirname(config), "ramonda.css.generated.ts");
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

  const sheet = join(dirname(config), "ramonda.css.generated.css");
  return existsSync(sheet) ? sheet : undefined;
}
