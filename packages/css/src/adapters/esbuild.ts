import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { knownNames, configReader, environmentOf } from "../config/config";
import { variablesSheetFor, writeGenerated } from "../config/generate";
import { readModule } from "./modules";
import { CssBlockError, positionOf } from "../compiler/errors";
import { settingsAgainst } from "../compiler/declaredSet";
import { fileMayHoldABlock, mayHoldABlock } from "../compiler/scan";
import { Sheet } from "../compiler/sheet";
import { transform } from "../compiler/transform";

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
 * Everything but the plumbing is the Vite plugin's: one `Sheet`, one stylesheet module per source
 * file, a class named after the hash of what it sets. What differs is how a file is handed over.
 *
 * **esbuild hands a plugin a path, not the code**, so a file is read to be asked whether it holds a
 * block, and a file that does not is read again by esbuild. That read is the whole cost — +60% on a
 * build of 400 small modules with no block in them; this package's own work adds 0.3 µs a file.
 * Handing the contents back to spare esbuild the read would claim the file from every other plugin,
 * so this declines it instead, and `filter` is how a project keeps the read to the files that matter.
 *
 * **A transformed file is given its loader**, since esbuild only picks one for a file a plugin
 * declines. A `.js` holding a block is loaded as `jsx`: a block in a JSX attribute leaves JSX behind.
 *
 * **`onEnd` checks what post-processing did to the stylesheet**, when the build lets a plugin see it:
 * `write: false` hands back the text and `metafile: true` names the files. With neither, there is
 * nothing to check.
 *
 * esbuild is not imported and not a dependency — its types are declared below — so this package can
 * be used without it.
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
  /**
   * What the build was asked for, of which only the working directory is read.
   *
   * A location esbuild reports is RELATIVE to it — measured, a file under `/private/tmp` came back
   * as `../../../../../private/tmp/…` from a build run elsewhere — so a path from an error cannot be
   * opened without it. Optional because a caller holding an older esbuild still satisfies the rest
   * of this shape, and a missing one falls back to the process's own directory, which is what
   * esbuild does.
   */
  readonly initialOptions?: {
    absWorkingDir?: string;
    /** esbuild's own production signal, and what its users reach for first. */
    minify?: boolean;
    /** `{ "process.env.NODE_ENV": '"production"' }` — the unambiguous way to say which build this is. */
    define?: Record<string, string>;
  };
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
  /** The folder a relative path in the contents is read from. */
  resolveDir?: string;
  errors?: { text: string; location: { file: string; line: number; column: number } }[];
}

interface BuildOutput {
  outputFiles?: readonly { path: string; text: string }[];
  metafile?: { outputs: Record<string, unknown> };
  /**
   * What the build refused on, which `onEnd` is given whether or not the build succeeded.
   *
   * Declared here rather than imported, like everything else in this file: a package whose types
   * drag in a bundler is a package that cannot be used without it. `notes` are esbuild's own way of
   * hanging a second line under an error, which is where a hint belongs — it does not replace what
   * the bundler said, and a reader sees both.
   */
  errors?: { text: string; location?: { file: string } | null; notes?: { text: string }[] }[];
}

export interface EsbuildCssPluginLike {
  name: string;
  setup(build: EsbuildLike): void;
}

/** The same spelling the Vite plugin uses, so a stylesheet's id names the file it belongs to. */
const SUFFIX = "?ramonda-css.css";

/** What a note of ours is prefixed with, so a reader knows who spoke and this can find its own. */
const TAG = "[ramonda-css]";

/** Where the stylesheet modules live, so esbuild does not look for them on disk. */
const NAMESPACE = "ramonda-css";

const SOURCE = /\.[cm]?[jt]sx?$/;

/** What esbuild is told a transformed file is. See the note above about `.js`. */
export function loaderFor(path: string): "tsx" | "ts" | "jsx" {
  if (path.endsWith(".tsx")) return "tsx";
  if (/\.[cm]?ts$/.test(path)) return "ts";
  return "jsx";
}

/**
 * Whether this is a production build, read off what esbuild was asked to do — a config may depend on
 * it (`env.production ? … : …`), and reading `NODE_ENV` alone let a minified build take the
 * development half of such a config.
 *
 * `define` first, because setting `process.env.NODE_ENV` says which build this is. `minify` second,
 * an inference nobody minifies against. `NODE_ENV` last. When in doubt, production: a build read as
 * production by mistake is refused where the author can see it, while one read as development by
 * mistake ships the looser rules without a word.
 */
function productionFrom(options: { minify?: boolean; define?: Record<string, string> } | undefined): boolean {
  const said = options?.define?.["process.env.NODE_ENV"];
  // esbuild's `define` values are JavaScript source, so the quotes are part of it.
  if (said !== undefined) return said.replace(/^["'`]|["'`]$/g, "") === "production";
  if (options?.minify === true) return true;
  return process.env.NODE_ENV === "production";
}

export function ramondaCss(options: EsbuildCssPluginOptions = {}): EsbuildCssPluginLike {
  const sheet = new Sheet();
  /**
   * The project's own settings, through the same reader the editor and `ramonda-check` use, with
   * `typescript` — a peer dependency, so a project with a tsconfig has it. Node 24 can `require` a
   * `.ts` file directly and that would be one import less, but it would be a SECOND way to read one
   * config: the editor cannot use it, and two readers of one file is this repository's recurring
   * fault.
   *
   * Anchored on the file being loaded rather than on `process.cwd()`, and re-read when its text
   * changes — see {@link configReader}.
   *
   * **Which build this is comes from the build**, and a lambda rather than a value because the
   * options are not known until `setup` runs — see {@link productionFrom}.
   */
  let production: boolean | undefined;
  const configFor = configReader(ts, () => environmentOf(production));

  /** Files that currently contribute rules, so a file losing its last block is noticed. */
  const styled = new Set<string>();

  return {
    name: "ramonda-css",

    setup(build) {
      /**
       * Codegen, once, before anything is resolved: user code imports the generated module, so a
       * lazy run on the first file would come after that import had already failed. From the build's
       * working directory — the one question here with no file to walk up from.
       */
      production = productionFrom(build.initialOptions);
      writeGenerated(build.initialOptions?.absWorkingDir ?? process.cwd(), ts);

      build.onResolve({ filter: /\?ramonda-css\.css$/ }, (args) => ({ path: args.path, namespace: NAMESPACE }));

      /**
       * `resolveDir` is the folder of the file that holds the block, so a relative `url( … )` is read
       * from there, as Vite reads it. A stylesheet in a namespace of its own has no folder otherwise,
       * and `url("./a.png")` failed with the file right beside it.
       */
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
        const file = args.path.slice(0, -SUFFIX.length);
        return { contents: sheet.cssFor(file), loader: "css", resolveDir: dirname(file) };
      });

      /**
       * A project stylesheet setting a declared variable its declaration does not allow — the same
       * judgement a block gets, for the plain CSS a theme is written in. See `checkStylesheet` in
       * `vite.ts`. Declined when it is fine, so esbuild loads it with its own `css` loader.
       */
      build.onLoad({ filter: /\.css$/ }, (args) => {
        if (args.path.includes("node_modules")) return undefined;
        const config = configFor(args.path);
        if (config === undefined || config.rules?.["token-set-against-its-declaration"] === "off") return undefined;
        if (variablesSheetFor(args.path) === resolve(args.path)) return undefined;
        const code = readFileSync(args.path, "utf8");
        const [first] = settingsAgainst(code, config);
        if (first === undefined) return undefined;
        const { line, column } = positionOf(code, first.at);
        return {
          errors: [
            {
              text: `token-set-against-its-declaration: ${first.message}`,
              location: { file: args.path, line, column: column - 1 },
            },
          ],
        };
      });

      build.onLoad({ filter: options.filter ?? SOURCE }, (args) => {
        // The regex above is esbuild's own coarse filter; this is the question every consumer asks.
        if (!fileMayHoldABlock(args.path) || args.path.includes("node_modules")) return undefined;

        const code = readFileSync(args.path, "utf8");
        // Asked once per file: every call walks up the tree and reads the config to see if it changed.
        const config = configFor(args.path);

        let result: ReturnType<typeof transform>;
        try {
          result = transform(code, {
            filename: args.path,
            runtime: options.runtime,
            read: readModule,
            config,
          });
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

        /**
         * Nothing here to compile, so esbuild reads the file with its own loader — and if the file had
         * blocks before, the sheet is told. On a rebuild after the last block is deleted, the sheet
         * would otherwise still promise its rule, and `verify` would blame post-processing for a class
         * nothing names any more.
         */
        if (result === undefined) {
          if (styled.delete(args.path)) sheet.add(args.path, []);
          return undefined;
        }

        styled.add(args.path);
        sheet.add(args.path, result.blocks, { ...result.variables, known: knownNames(config) });
        const own = sheet.cssFor(args.path);
        /**
         * The project's `tokens.css` is imported here, beside the file's own rules: without it a token
         * resolves to its registered initial value only, and the page has the right classes and none
         * of the theme. Imported for the project rather than left to it, and deduplicated by path.
         */
        const declared = variablesSheetFor(args.path);
        const contents =
          own === ""
            ? result.code
            : `${result.code}\n` +
              `${declared === undefined ? "" : `import ${JSON.stringify(declared)};\n`}` +
              `import ${JSON.stringify(args.path + SUFFIX)};\n`;

        return { contents, loader: loaderFor(args.path) };
      });

      /**
       * What came back from post-processing, checked against what the sheet promised — the same check
       * the Vite plugin runs in `generateBundle`, and it guards the same invisible failure: the class
       * name is in the emitted JavaScript, so a rule that was renamed or dropped ships a page
       * pointing at nothing.
       */
      build.onEnd((result) => {
        /**
         * A parse error in a file holding a block that `filter` kept from this plugin — esbuild then
         * says *Expected identifier but found "@"*, which names nothing to fix. A note under the error
         * says the filter is too narrow. Asked only of files the build already failed on.
         */
        for (const error of result.errors ?? []) {
          const file = error.location?.file;
          if (file === undefined || error.notes?.some((note) => note.text.includes(TAG))) continue;
          if (options.filter === undefined || options.filter.test(file)) continue;

          // esbuild reports a location relative to the build's working directory, not as a path a
          // reader could open — see `initialOptions`.
          const path = resolve(build.initialOptions?.absWorkingDir ?? process.cwd(), file);
          let source: string;
          try {
            source = readFileSync(path, "utf8");
          } catch {
            continue;
          }
          if (!mayHoldABlock(source)) continue;

          error.notes = [
            ...(error.notes ?? []),
            {
              text:
                `${TAG} \`${file}\` holds a style block and this plugin's \`filter\` does not reach it, ` +
                "so esbuild parsed the block as JavaScript. Widen the filter to cover this file.",
            },
          ];
        }

        // Every file is in, so the question no single file can answer is answerable now. Asked
        // before the stylesheet is looked for, because it does not depend on one being written —
        // an SSR build emits no CSS and still reads variables.
        sheet.verifyVariables();

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
