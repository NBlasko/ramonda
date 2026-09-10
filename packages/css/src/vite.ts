import { CssBlockError } from "./compiler/errors";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { type Config, configReader, environmentOf } from "./config";
import { warnIfStale } from "./stale";
import { readModule } from "./modules";
import { loaderFor } from "./esbuild";
import { mayHoldABlock } from "./compiler/scan";
import { Sheet } from "./compiler/sheet";
import { type SourceMap, transform } from "./compiler/transform";

/**
 * `@ramonda/css/vite` — the plugin that makes a block render.
 *
 * ```ts
 * import { defineConfig } from "vite";
 * import { ramondaCss } from "@ramonda/css/vite";
 *
 * export default defineConfig({ plugins: [ramondaCss()] });
 * ```
 *
 * That is the whole of what an app writes. **There is no stylesheet to import**, and that is a
 * measurement rather than a convenience — see below.
 *
 * ## `enforce: "pre"` is a requirement, not a preference
 *
 * Measured both ways before any of this was written: without it the plugin runs AFTER Vite's own
 * esbuild step, which has already refused the file — the syntax is not TypeScript, and esbuild is
 * what says so. The same ordering covers the dev server, the production build and the test runner,
 * because all three transform through Vite.
 *
 * ## The stylesheet is a module, and there is one PER FILE
 *
 * A virtual module, so the CSS takes part in the module graph: HMR can replace it without touching
 * any JavaScript, and the production build hashes and links it like any other stylesheet. A file
 * written to disk would need its own watcher and its own link tag.
 *
 * **One per file, and the first design had one for the whole app.** Measured on a real build, that
 * shipped no CSS at all: the entry imported the shared stylesheet, Rollup loaded that module before
 * the styled file had been transformed, the sheet was empty, and the build was green with an
 * unstyled page. A bundler does not wait for the transform to finish.
 *
 * So the plugin appends `import "<file>?ramonda-css"` to the file whose blocks produced the rules.
 * The ordering problem cannot arise — the rules exist because that file was just read — an app
 * imports nothing, and **the CSS follows the JavaScript chunk**, which is what per-route splitting
 * needs and is now a decision the bundler has already made.
 *
 * What is deduped is the CLASS: identical blocks agree on one name and the browser applies one rule.
 * Each file serves that rule itself, because a chunk has to stand on its own — an owner-per-rule was
 * tried, and measured through a real build it left one lazily-loaded route naming a class no
 * stylesheet contained. See `Sheet`.
 *
 * ## Structural types, on purpose
 *
 * Vite is not imported and is not a dependency. Vite accepts any object with a `name` and hooks it
 * recognises, and `@ramonda/build/vite` already does it this way for the same reason: a package
 * whose types drag in the whole of Vite is a package that cannot be used from an esbuild-only
 * setup, or from a test that does not want a bundler at all.
 */

export interface CssPluginOptions {
  /**
   * Where `block` is imported from in the emitted code. Defaults to `@ramonda/css`.
   *
   * The one thing a wrapper for another JSX library changes: point it at a module that re-exports
   * `block`, and the same transform produces a value that library's own `css` prop can take. The
   * transform has always accepted it; this is where a plugin user reaches it.
   */
  readonly runtime?: string;
}

/** What Vite is handed. Only the hooks this uses are declared. */
/** The bit of esbuild's plugin API the dependency scan hands us. Declared, never imported. */
interface ScanBuild {
  onLoad(
    filter: { filter: RegExp },
    callback: (args: { path: string }) => { contents: string; loader: string } | null,
  ): void;
}

/** What Vite hands a hot-update hook. Only what this reads is declared. */
export interface HotUpdate {
  readonly file: string;
  read(): string | Promise<string>;
}

export interface CssPluginLike {
  name: string;
  enforce: "pre";
  config(this: unknown, userConfig: unknown, environment: { mode?: string } | undefined): unknown;
  resolveId(this: unknown, id: string): string | null;
  load(this: unknown, id: string): string | null;
  transform(this: unknown, code: string, id: string): { code: string; map: SourceMap } | null;
  handleHotUpdate(this: unknown, context: HotUpdate): Promise<void>;
  hotUpdate(this: unknown, context: HotUpdate): Promise<void>;
  generateBundle(this: unknown, options: unknown, bundle: Bundle): void;
}

/** What a bundler hands back at the end of a build. Only what this reads is declared. */
export type Bundle = Record<string, { type?: string; fileName?: string; source?: unknown }>;

/**
 * The query that turns a source file's id into its stylesheet's.
 *
 * A query rather than a prefix, and a `.css` extension after it, because Vite decides a module is
 * CSS from its id — so the id has to keep the real path (which is how the graph knows which file the
 * stylesheet belongs to) and end in something Vite reads as a stylesheet.
 */
const SUFFIX = "?ramonda-css.css";

/** Only these are source. A `.css`, a `.json` or somebody else's virtual module is not ours to read. */
const SOURCE = /\.[cm]?[jt]sx?$/;

export function ramondaCss(options: CssPluginOptions = {}): CssPluginLike {
  /**
   * The project's own settings, through the same reader the editor and `ramonda-check` use, with
   * `typescript` — a peer dependency, so a project with a tsconfig has it. Node 24 can `require` a
   * `.ts` file directly and that would be one import less, but it would be a SECOND way to read one
   * config: the editor cannot use it, and two readers of one file is this repository's recurring
   * fault.
   *
   * Which config, and when, are both a review's findings. The config that governs a file is the one
   * above THAT FILE, not the one above `process.cwd()` — a monorepo's packages have their own, and
   * an answer that depends on where a command was typed is an answer the editor need not share. And
   * it is re-read when its text changes rather than once here, because a dev server outlives the
   * settings it booted with. See {@link configReader} for both.
   *
   * `production` is a function of it for a third reason: Vite says which build this is in the
   * `config` hook, and a plugin is constructed before any hook runs — so the answer does not exist
   * yet at this line. Asking for it per read is safe, since Vite resolves its config before it
   * transforms anything.
   */
  let production: boolean | undefined;
  const configFor = configReader(ts, () => environmentOf(production));

  // Said once, when the built package is behind its sources — see `warnIfStale` for the day it cost.
  // `fileURLToPath`, not a string replace: a `file://` url PERCENT-ENCODES, so a checkout at
  // `~/My Projects/…` came back with `%20` still in it, `readdirSync` threw ENOENT, and the warning
  // written because staleness cost a day went silently dead — indistinguishable from a published
  // package with no `src`. The editor, which uses `__filename`, warned; the build did not.
  warnIfStale(fileURLToPath(import.meta.url), (message) => console.warn(message));

  /**
   * One sheet per plugin instance, and the plugin is created per Vite config — so a dev server and a
   * build in the same process do not share one, and neither do two Vitest projects.
   */
  const sheet = new Sheet();
  /** Files that currently contribute rules, so a file losing its last block is noticed. */
  const styled = new Set<string>();

  /**
   * The last compile of a file that had blocks: what it was compiled FROM, and what came out.
   *
   * Two hooks need the same answer within one save — see {@link CssPluginLike.hotUpdate} — and this
   * is what keeps it ONE answer rather than two compiles that could disagree.
   *
   * Keyed by what the answer depends on, which is the source text AND the settings, so a stale entry
   * cannot be served: either one different is a different compile.
   *
   * Only a file that HAS blocks is remembered. Everything else is the overwhelming majority, and
   * what it costs to answer again is one scan of the text.
   */
  const compiled = new Map<
    string,
    { source: string; config: Config; result: NonNullable<ReturnType<typeof transform>> }
  >();

  /**
   * What a file compiles to, and the only place the sheet is told.
   *
   * `undefined` for a file with no blocks — which is still told to the sheet, and only if it had some
   * before. Found by a failing test: returning early meant an author who deleted the last block from
   * a file left its rules in the sheet for the life of the dev server — and, worse, left the class
   * NAME claimed, so re-adding an edited block collided with the one it used to be.
   *
   * `styled` is what makes that free: a file that never had a block is not looked up at all.
   */
  function compile(file: string, code: string) {
    /**
     * Asked first, and it is half the key.
     *
     * A dev server outlives the settings it booted with, and {@link configReader} answers with a new
     * object when the file's text changes — so remembering the source text alone made a config edit
     * invisible for as long as the file itself was not touched. Found by the test standing over that
     * finding, which went red the moment the source text alone was the key.
     */
    const config = configFor(file);

    const remembered = compiled.get(file);
    if (remembered?.source === code && remembered.config === config) return remembered.result;

    let result: ReturnType<typeof transform>;
    try {
      result = transform(code, { filename: file, runtime: options.runtime, read: readModule, config });
    } catch (error) {
      if (!(error instanceof CssBlockError)) throw error;
      /**
       * Vite reads `id` and `loc` off a thrown error to print the frame with a caret under it, so
       * a refusal arrives as a position in the author's file rather than as a stack trace.
       *
       * **`loc.column` is 0-based, and it had to be measured.** The type says `column: number` and
       * nothing else, and Vite echoes whatever it is given — so a wrong base is a caret one
       * character off and no error anywhere. Measured on a real parse error at a known position:
       * `@` on 1-based column 20 was reported as `1:19`, with the caret under it. Positions here
       * are 1-based, the way an editor counts, so this is where they convert.
       */
      throw Object.assign(new Error(error.message), {
        id: error.filename,
        loc: { line: error.line, column: error.column - 1 },
      });
    }

    if (result === undefined) {
      compiled.delete(file);
      if (styled.has(file)) {
        styled.delete(file);
        sheet.add(file, []);
      }
      return undefined;
    }

    styled.add(file);
    /**
     * Only this file's CSS can have moved.
     *
     * A file serves every rule it names, so one file's edit cannot change what another file
     * serves — and its own stylesheet is reloaded along with the JavaScript Vite has just read.
     * This used to tell other files too, because ownership moved rules between them; that
     * mechanism could not work and is gone with the ownership that needed it.
     */
    sheet.add(file, result.blocks, { ...result.variables, known: config.variables });
    compiled.set(file, { source: code, config, result });
    return result;
  }

  /** What both hot-update hooks do. See where they are returned for why there are two of them. */
  async function recompile(context: HotUpdate): Promise<void> {
    const file = context.file;
    if (!SOURCE.test(file) || file.includes("node_modules")) return;

    const code = await context.read();
    // A file that has never held a block, and does not now, has nothing here to be stale.
    if (!styled.has(file) && !mayHoldABlock(code)) return;

    try {
      compile(file, code);
    } catch {
      // Swallowed on purpose — see the hooks. The memo still holds the last compile that worked,
      // and its source is not this one, so the transform will compile again and report.
    }
  }

  return {
    name: "ramonda-css",

    /**
     * The dependency SCAN is a second pass, and it never sees this plugin.
     *
     * Reported from a real `pnpm dev`: the server starts, the first request arrives, and the scan
     * fails with *Expected identifier but found "@"* on every file holding a block — then
     * *Skipping dependency pre-bundling*, which means every bare import is served unbundled and the
     * page loads hundreds of modules or breaks outright.
     *
     * Vite pre-bundles a project's dependencies by walking its entries with **esbuild**, and that
     * walk has its own plugin list — `transform` above is Rollup's and is not consulted. So the same
     * transform is handed to it here. It only has to make the file PARSE, because all the scan wants
     * is the imports; a block that the real transform would refuse is left alone rather than thrown
     * from, since a scan is not where an author should meet a diagnostic.
     */
    config(_userConfig, environment) {
      // Vite's own `isProduction` is exactly this, and it is the answer a config asks for.
      production = environment?.mode === "production";
      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              {
                name: "ramonda-css:scan",
                setup(build: ScanBuild) {
                  build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, (args: { path: string }) => {
                    let source: string;
                    try {
                      source = readFileSync(args.path, "utf8");
                    } catch {
                      return null;
                    }
                    if (!mayHoldABlock(source)) return null;

                    try {
                      const result = transform(source, {
                        filename: args.path,
                        runtime: options.runtime,
                        read: readModule,
                      });
                      return result === undefined ? null : { contents: result.code, loader: loaderFor(args.path) };
                    } catch {
                      // The real transform reports it, at the author's own line. Twice is worse.
                      return null;
                    }
                  });
                },
              },
            ],
          },
        },
      };
    },
    /** See the note above: this is what puts the transform before esbuild. Measured, not assumed. */
    enforce: "pre",

    /**
     * Claimed here, or Vite tries to read `Card.tsx?ramonda-css.css` off the disk and fails. The
     * name is returned unchanged because it already carries the real path, which is what makes the
     * graph put the stylesheet beside the file it belongs to.
     */
    resolveId(id) {
      return id.endsWith(SUFFIX) ? id : null;
    },

    load(id) {
      return id.endsWith(SUFFIX) ? sheet.cssFor(id.slice(0, -SUFFIX.length)) : null;
    },

    transform(this: unknown, code, id) {
      // Our own stylesheet, coming back round. Read by `load` and never transformed.
      if (id.endsWith(SUFFIX)) return null;

      const file = id.split("?")[0];
      // A query string is Vite's — `?used`, `?v=hash`, `?worker`. A file skipped because of one is a
      // file whose blocks silently do not compile.
      if (!SOURCE.test(file) || file.includes("node_modules") || id.startsWith("\0")) return null;

      const result = compile(file, code);
      if (result === undefined) return null;

      /**
       * The import that carries this file's rules, appended rather than prepended: the CSS is applied
       * to elements this module creates, and a stylesheet's own position in the file decides nothing
       * about that. Appending leaves every source position — and therefore the map — untouched.
       */
      const own = sheet.cssFor(file);
      const code2 = own === "" ? result.code : `${result.code}\nimport ${JSON.stringify(file + SUFFIX)};\n`;

      return { code: code2, map: result.map };
    },

    /**
     * The sheet is made fresh HERE, before either module is served.
     *
     * Measured on a real dev server: a save left the stylesheet exactly one save behind, every time.
     * A save invalidates both the file and its stylesheet — Vite sends both in one update payload —
     * and the client fetches them together. `load` answers the stylesheet out of the sheet, which is
     * a string in a Map; the file has to run the compiler. So the stylesheet always wins the race
     * and is served from a sheet still holding the PREVIOUS save's blocks, which Vite then caches.
     * The page keeps the old rules until the next save, and the class the JavaScript names is in no
     * stylesheet at all.
     *
     * Declaring the dependency was tried first and does not work in dev: `this.load({ id: file })`
     * runs the plugin container's `load` hooks, and reading a source file off the disk is not one of
     * them — so the code comes back null, the transform never runs, and the sheet is untouched.
     *
     * This is not a second answer to "what does this file compile to". {@link compile} is the one
     * answer and it remembers what it was given, so the file's own `transform` reuses what this left
     * behind rather than compiling again. A refusal is swallowed, because this is not where an author
     * should meet a diagnostic — the transform reports it at their line, moments later, and Vite
     * turns a throw from here into a SECOND overlay saying the same thing.
     *
     * Under both names, because Vite 6 renamed the hook to `hotUpdate` and Vite 5 only has the old
     * one. Vite calls `hotUpdate` when a plugin has it and `handleHotUpdate` when it does not, so
     * exactly one of these runs — and they are one function, not two answers.
     */
    handleHotUpdate: recompile,
    hotUpdate: recompile,

    /**
     * What came back from post-processing, checked against what the sheet promised.
     *
     * The failure this catches is invisible by construction: the class name is written into the
     * emitted JavaScript, so a minifier that renames or drops a rule ships a page pointing at a class
     * that is not in the stylesheet. Nothing throws, the page renders unstyled, and there is nothing
     * to blame it on. Merging is allowed and keeps the name — `.a,.r-… { … }` — so the question is
     * only whether the name survived, which is what a rename or a drop destroys and nothing else does.
     *
     * **Every CSS asset at once, and none is not a failure.** A rule may land in any chunk, so the
     * check is against the concatenation. And a build that emitted no stylesheet at all is not
     * evidence of anything — an SSR build is the ordinary case, where the client build is what writes
     * the CSS — so there is nothing to check rather than everything to report.
     */
    generateBundle(_options, bundle) {
      const sheets = Object.values(bundle).filter(
        (output) => output.type === "asset" && typeof output.source === "string" && output.fileName?.endsWith(".css"),
      );
      if (sheets.length === 0) return;

      // Every file is in, so the question no single file can answer is answerable now.
      sheet.verifyVariables();

      sheet.verify(
        sheets.map((output) => output.source as string).join("\n"),
        sheets.map((output) => output.fileName).join(", "),
      );
    },
  };
}
