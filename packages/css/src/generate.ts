import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  const declarations = config.variables;
  if (declarations === undefined) return { config: path, declared: 0, files: [] };

  /**
   * Checked before anything is written, so a collision cannot leave half a pair of files behind.
   *
   * `generate` verifies too — this is the same call, made early rather than a second rule. See
   * `verifyNames` for why the walk and the verdict are separate to begin with.
   */
  const named = namesIn(declarations);
  verifyNames(named);
  if (named.length === 0) return { config: path, declared: 0, files: [] };

  const { css, module } = generate(declarations);
  const beside = dirname(path);

  return {
    config: path,
    declared: named.length,
    files: [put(join(beside, "ramonda.css.generated.css"), css), put(join(beside, "ramonda.css.generated.ts"), module)],
  };
}
