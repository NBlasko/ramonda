import { readFileSync } from "node:fs";
import { CssBlockError } from "./compiler/errors";
import { Sheet } from "./compiler/sheet";
import { transform } from "./compiler/transform";

/**
 * `@ramonda/css/esbuild` — the same feature for a build that has no Vite in it.
 *
 * ```ts
 * import { build } from "esbuild";
 * import { ramondaCss } from "@ramonda/css/esbuild";
 *
 * await build({ entryPoints: ["src/index.tsx"], bundle: true, plugins: [ramondaCss()] });
 * ```
 *
 * ## What is the same, and it is nearly everything
 *
 * One `Sheet`, one stylesheet module per source file, the class named after the hash of the block —
 * none of that is a bundler's business. What changes is only how a plugin is told about a file and
 * how a virtual module is spelled.
 *
 * ## What is different, and what it costs
 *
 * **esbuild hands a plugin a PATH, not the code.** Vite passes the source in; here the file has to be
 * read to be asked the cheap question, and a file with no block is then read a second time by
 * esbuild. Measured on 400 tiny modules, none holding a block:
 *
 * | | |
 * |---|---|
 * | esbuild alone | 11.4 ms |
 * | a plugin that does nothing but be asked | +12%, 3.4 µs/file |
 * | …and reads the file | **+60%, 17.3 µs/file** |
 * | …and does everything this one does | +60%, 17.1 µs/file |
 *
 * **The read is the whole cost**, and this package's own work on top of it is 0.3 µs/file — the cheap
 * substring is as free here as everywhere else. Reading the bytes without decoding them is not
 * faster (+62%), so it is the syscall rather than the UTF-8. And minifying with source maps does not
 * dilute it: +61% on that build too, because esbuild's minifier is that fast.
 *
 * **The obvious fix is worse than the cost.** Handing the contents back so esbuild does not read
 * again means claiming the file, and claiming it does two things: no other `onLoad` plugin is
 * offered it, and the loader has to be named. Measured, contents returned with no loader are parsed
 * as plain JavaScript — *"The JSX syntax extension is not currently enabled"*, on every file.
 *
 * So it declines, and `filter` is the lever a project has: point it at the tree that holds blocks and
 * nothing else is read at all.
 *
 * **A transformed file needs its loader named.** esbuild picks one from the extension only when a
 * plugin declines the file, so the mapping is here — and a `.js` holding a block is loaded as `jsx`,
 * because a block written as a JSX attribute leaves JSX behind in a file esbuild would otherwise
 * parse as plain JavaScript. That only applies to a file that holds one, which is already not plain.
 *
 * **`onEnd` is where post-processing is checked**, and what it can see depends on how the build was
 * asked to run: `write: false` hands back the output text, and `metafile: true` names the files on
 * disk. With neither there is nothing to check — the same answer the Vite plugin gives a build that
 * emitted no stylesheet, and for the same reason.
 *
 * ## Structural types, on purpose
 *
 * esbuild is not imported and is not a dependency, the way `./vite` does not import Vite: a package
 * whose types drag in a bundler is a package that cannot be used without it.
 */

export interface EsbuildCssPluginOptions {
  /** Where `block` is imported from in the emitted code. Defaults to `@ramonda/css`. */
  readonly runtime?: string;
  /**
   * Which paths are looked at, as esbuild's own `onLoad` filter. Defaults to every source extension.
   *
   * The lever for the cost above: a plugin that is asked about a file has to read it to answer, so a
   * project that keeps its blocks under one tree can say so — `/src\/.*\.tsx$/` — and everything
   * else is never read. A file this does not look at is compiled by esbuild exactly as it would be
   * with no plugin at all.
   */
  readonly filter?: RegExp;
}

/** The handful of esbuild's plugin API this reaches for, declared rather than imported. */
export interface EsbuildLike {
  onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => Resolved | undefined): void;
  onLoad(
    options: { filter: RegExp; namespace?: string },
    callback: (args: { path: string }) => Loaded | undefined,
  ): void;
  onEnd(callback: (result: BuildOutput) => void): void;
}

interface Resolved {
  path: string;
  namespace: string;
}

interface Loaded {
  contents?: string;
  /**
   * Named as the literal loaders this returns rather than as `string`.
   *
   * Not a nicety: a plugin object whose `loader` is `string` is not assignable to esbuild's own
   * `Plugin`, so a user passing it in gets a type error on the line where it is used, about a
   * variance three levels down. The declared shape has to fit through esbuild's, not merely
   * resemble it.
   */
  loader?: "tsx" | "ts" | "jsx" | "js" | "css";
  errors?: { text: string; location: { file: string; line: number; column: number } }[];
}

interface BuildOutput {
  outputFiles?: readonly { path: string; text: string }[];
  metafile?: { outputs: Record<string, unknown> };
}

export interface EsbuildCssPluginLike {
  name: string;
  setup(build: EsbuildLike): void;
}

/** The same spelling the Vite plugin uses, so a stylesheet's id names the file it belongs to. */
const SUFFIX = "?ramonda-css.css";

/** Where the stylesheet modules live, so esbuild does not look for them on disk. */
const NAMESPACE = "ramonda-css";

const SOURCE = /\.[cm]?[jt]sx?$/;

/** What esbuild is told a transformed file is. See the note above about `.js`. */
function loaderFor(path: string): "tsx" | "ts" | "jsx" {
  if (path.endsWith(".tsx")) return "tsx";
  if (/\.[cm]?ts$/.test(path)) return "ts";
  return "jsx";
}

export function ramondaCss(options: EsbuildCssPluginOptions = {}): EsbuildCssPluginLike {
  const sheet = new Sheet();

  return {
    name: "ramonda-css",

    setup(build) {
      build.onResolve({ filter: /\?ramonda-css\.css$/ }, (args) => ({ path: args.path, namespace: NAMESPACE }));

      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => ({
        contents: sheet.cssFor(args.path.slice(0, -SUFFIX.length)),
        loader: "css",
      }));

      build.onLoad({ filter: options.filter ?? SOURCE }, (args) => {
        if (args.path.includes("node_modules")) return undefined;

        const code = readFileSync(args.path, "utf8");

        let result: ReturnType<typeof transform>;
        try {
          result = transform(code, { filename: args.path, runtime: options.runtime });
        } catch (error) {
          if (!(error instanceof CssBlockError)) throw error;
          /**
           * A refusal as a position rather than a stack trace. esbuild's `column` is 0-based — the
           * same convention Vite's `loc` uses, and the same conversion, because positions in this
           * package are 1-based the way an editor counts them.
           */
          return {
            errors: [
              {
                text: error.message,
                location: { file: error.filename, line: error.line, column: error.column - 1 },
              },
            ],
          };
        }

        // Nothing here to compile. Declined, so esbuild reads it with the loader it would have used.
        if (result === undefined) return undefined;

        sheet.add(args.path, result.blocks);
        const own = sheet.cssFor(args.path);
        const contents = own === "" ? result.code : `${result.code}\nimport ${JSON.stringify(args.path + SUFFIX)};\n`;

        return { contents, loader: loaderFor(args.path) };
      });

      /**
       * What came back from post-processing, checked against what the sheet promised — the same check
       * the Vite plugin runs in `generateBundle`, and it guards the same invisible failure: the class
       * name is in the emitted JavaScript, so a rule that was renamed or dropped ships a page
       * pointing at nothing.
       */
      build.onEnd((result) => {
        const css = stylesheets(result);
        if (css === undefined) return;

        sheet.verify(css.text, css.where);
      });
    },
  };
}

/**
 * Every CSS the build produced, however this build was asked to produce it — or nothing, when it was
 * asked in a way that keeps them from a plugin.
 *
 * `write: false` is the easy case. `metafile: true` names the files and they are read off disk. With
 * neither, a plugin cannot see the output at all, and there is nothing to check rather than
 * everything to report.
 */
function stylesheets(result: BuildOutput): { text: string; where: string } | undefined {
  const sheets = (result.outputFiles ?? []).filter((file) => file.path.endsWith(".css"));
  if (sheets.length > 0) {
    return { text: sheets.map((file) => file.text).join("\n"), where: sheets.map((file) => file.path).join(", ") };
  }

  const named = Object.keys(result.metafile?.outputs ?? {}).filter((path) => path.endsWith(".css"));
  if (named.length === 0) return undefined;

  return { text: named.map((path) => readFileSync(path, "utf8")).join("\n"), where: named.join(", ") };
}
