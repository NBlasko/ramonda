import { CssBlockError, positionOf } from "../compiler/errors";
import { readFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { knownNames, type Config, configReader, environmentOf } from "../config/config";
import { forgetGenerated, variablesSheetFor, writeGenerated } from "../config/generate";
import { settingsAgainst } from "../compiler/declaredSet";
import { warnIfStale } from "./stale";
import { readModule } from "./modules";
import { loaderFor } from "./esbuild";
import { fileMayHoldABlock, mayHoldABlock } from "../compiler/scan";
import { Sheet } from "../compiler/sheet";
import { type SourceMap, transform } from "../compiler/transform";

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
 * Measured both ways: without it the plugin runs AFTER Vite's own esbuild step, which has already
 * refused the file — the syntax is not TypeScript, and esbuild is what says so. The same ordering
 * covers the dev server, the production build and the test runner, because all three transform
 * through Vite.
 *
 * ## The stylesheet is a module, and there is one PER FILE
 *
 * A virtual module, so the CSS takes part in the module graph: HMR can replace it without touching
 * any JavaScript, and the production build hashes and links it like any other stylesheet. A file
 * written to disk would need its own watcher and its own link tag.
 *
 * **One per file, not one for the whole app.** Measured on a real build, a shared stylesheet
 * shipped no CSS at all: the entry imported it, Rollup loaded that module before the styled file
 * had been transformed, the sheet was empty, and the build was green with an unstyled page. A
 * bundler does not wait for the transform to finish.
 *
 * So the plugin appends `import "<file>.ramonda-css.css"` to the file whose blocks produced the rules.
 * The ordering problem cannot arise — the rules exist because that file was just read — an app
 * imports nothing, and **the CSS follows the JavaScript chunk**, which is what per-route splitting
 * needs and is a decision the bundler has already made.
 *
 * What is deduped is the CLASS: identical blocks agree on one name and the browser applies one
 * rule. Each file serves that rule itself, because a chunk has to stand on its own — with one owner
 * per rule, measured through a real build, a lazily-loaded route named a class no stylesheet
 * contained. See `Sheet`.
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
  /**
   * The running server, which only the CONFIG path needs — see `reconfigure`.
   *
   * Declared optional because both hooks this is the parameter of are handed slightly different
   * shapes by Vite, and because a test may call the hook with neither.
   */
  readonly server?: { moduleGraph?: ModuleGraphLike };
  /** The modules Vite found for the saved file — which do not include its stylesheet; see `recompile`. */
  readonly modules?: readonly unknown[];
}

/** What `reconfigure` needs of Vite's module graph, and nothing more. */
interface ModuleGraphLike {
  getModuleById(id: string): unknown;
  invalidateModule(mod: never): void;
}

/** What Vite is handed. Only the hooks this uses are declared. */
export interface CssPluginLike {
  name: string;
  enforce: "pre";
  /** Rollup's own, and the one hook that runs before anything is resolved — see its use below. */
  buildStart(this: unknown): void;
  config(this: unknown, userConfig: unknown, environment: { mode?: string; command?: string } | undefined): unknown;
  resolveId(this: unknown, id: string): string | null;
  load(this: unknown, id: string): string | { code: string; map: SourceMap } | null;
  transform(this: unknown, code: string, id: string): { code: string; map: SourceMap } | null;
  handleHotUpdate(this: unknown, context: HotUpdate): Promise<unknown[] | undefined>;
  hotUpdate(this: unknown, context: HotUpdate): Promise<unknown[] | undefined>;
  generateBundle(this: unknown, options: unknown, bundle: Bundle): void;
}

/** What a bundler hands back at the end of a build. Only what this reads is declared. */
export type Bundle = Record<string, { type?: string; fileName?: string; source?: unknown }>;

/**
 * What turns a source file's id into its stylesheet's.
 *
 * A suffix rather than a prefix, ending in `.css`, because Vite decides a module is CSS from its id —
 * so the id has to keep the real path (which is how the graph knows which file the stylesheet
 * belongs to) and end in something Vite reads as a stylesheet.
 *
 * **Not a query.** It was `?ramonda-css.css`, and Vite 8 fails the build on it: its Oxc transform
 * decides a module's language from the path with the query cut off, finds `Card.tsx`, and stops with
 * *Failed to detect the lang of Card.tsx?ramonda-css.css*. Measured on 8.3.4; Vite 7 read either.
 */
const SUFFIX = ".ramonda-css.css";

/** A module the scan may need to read: where a block can be written. */
const SCRIPT = /\.[cm]?[jt]sx?$/;

export function ramondaCss(options: CssPluginOptions = {}): CssPluginLike {
  /**
   * The project's own settings, through the same reader the editor and `ramonda-check` use, with
   * `typescript` — a peer dependency, so a project with a tsconfig has it. Node 24 can `require` a
   * `.ts` file directly and that would be one import less, but it would be a SECOND way to read one
   * config: the editor cannot use it, and two readers of one file is this repository's recurring
   * fault.
   *
   * The config that governs a file is the one above THAT FILE, not the one above `process.cwd()` —
   * a monorepo's packages have their own. And it is re-read when its text changes rather than once
   * here, because a dev server outlives the settings it booted with. See {@link configReader} for
   * both.
   *
   * `production` is a function of it for a third reason: Vite says which build this is in the
   * `config` hook, and a plugin is constructed before any hook runs — so the answer does not exist
   * yet at this line. Asking for it per read is safe, since Vite resolves its config before it
   * transforms anything.
   */
  let production: boolean | undefined;
  const configFor = configReader(ts, () => environmentOf(production));
  /** Where this project is, as Vite reports it. See `buildStart`. */
  let root = process.cwd();
  /**
   * The dev server, and only it: source marks are for a person looking at a page. Not a build, and
   * not a test run — Vitest serves in mode `test`, and a test comparing a whole `className` would
   * otherwise see marks its build never has. Decided by the COMMAND, in whatever mode the server
   * runs: keyed on the name `development`, `vite --mode staging` served no marks.
   */
  let developing = false;
  /** `vite build`, in whatever mode — a build writes one sheet and wants no map beside each file's. */
  let building = false;

  // Said once, when the built package is behind its sources — see `warnIfStale`. `fileURLToPath`,
  // not a string replace: a `file://` url PERCENT-ENCODES, so a checkout at `~/My Projects/…` would
  // keep its `%20`, `readdirSync` would throw ENOENT, and the warning would go silently dead.
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
   * `undefined` for a file with no blocks — which is still told to the sheet, and only if it had
   * some before. Returning early would leave the rules of a file whose last block was deleted in
   * the sheet for the life of the dev server — and leave the class NAME claimed, so re-adding an
   * edited block would collide with the one it used to be.
   *
   * `styled` is what makes that free: a file that never had a block is not looked up at all.
   */
  /**
   * A project stylesheet setting a declared variable its declaration does not allow.
   *
   * A theme is plain CSS, and plain CSS is where a fixed variable gets changed: measured, this
   * plugin is handed every stylesheet the app loads — imported, a CSS module, and one linked from
   * `index.html` — in a build and on the dev server, as written, since it runs first. The judgement
   * is the one a block gets (`declaredSet.ts`). The generated `tokens.css` is skipped: it is where
   * every variable is SET to its initial, which is the declaration itself.
   */
  function checkStylesheet(file: string, code: string): void {
    const config = configFor(file);
    if (config === undefined || config.rules?.["token-set-against-its-declaration"] === "off") return;
    if (variablesSheetFor(file) === resolve(file)) return;
    const [first] = settingsAgainst(code, config);
    if (first === undefined) return;
    const { line, column } = positionOf(code, first.at);
    throw Object.assign(new Error(`${file}:${line}:${column}  token-set-against-its-declaration: ${first.message}`), {
      id: file,
      loc: { line, column: column - 1 },
    });
  }

  function compile(file: string, code: string) {
    /**
     * Asked first, and it is half the key.
     *
     * A dev server outlives the settings it booted with, and {@link configReader} answers with a
     * new object when the file's text changes — so keyed on the source text alone, a config edit
     * would be invisible for as long as the file itself was not touched.
     */
    const config = configFor(file);

    const remembered = compiled.get(file);
    if (remembered?.source === code && remembered.config === config) return remembered.result;

    let result: ReturnType<typeof transform>;
    try {
      result = transform(code, {
        filename: file,
        runtime: options.runtime,
        read: readModule,
        config,
        // Relative to the project, with `/` on every platform: a mark names a file a person knows,
        // and an absolute path would print their disk's layout into every element.
        marks: developing ? relative(resolve(root), file).split(sep).join("/") : undefined,
      });
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
     * A file serves every rule it names, so one file's edit cannot change what another file serves
     * — and its own stylesheet is reloaded along with the JavaScript Vite has just read.
     */
    sheet.add(file, result.blocks, { ...result.variables, known: knownNames(config) });
    compiled.set(file, { source: code, config, result });
    return result;
  }

  /** What both hot-update hooks do. See where they are returned for why there are two of them. */
  async function recompile(this: unknown, context: HotUpdate): Promise<unknown[] | undefined> {
    const file = context.file;
    if (basename(file) === "ramonda.css.ts") {
      await reconfigure(file, context);
      return undefined;
    }
    if (!fileMayHoldABlock(file) || file.includes("node_modules")) return undefined;

    const code = await context.read();
    // A file that has never held a block, and does not now, has nothing here to be stale.
    if (!styled.has(file) && !mayHoldABlock(code)) return undefined;

    try {
      compile(file, code);
    } catch {
      // Swallowed on purpose — see the hooks. The memo still holds the last compile that worked,
      // and its source is not this one, so the transform will compile again and report.
    }

    /**
     * The file's stylesheet goes out with the file, because Vite no longer finds it on its own.
     *
     * While the id was `Card.tsx?ramonda-css.css` Vite filed the stylesheet under `Card.tsx`, and a
     * save of that file updated both. Under `Card.tsx.ramonda-css.css` — see {@link SUFFIX} — it is a
     * module of its own, and measured, every save served the previous save's rules. Read from the
     * graph of the environment being updated, which is the one `hotUpdate` runs for; a stylesheet
     * nothing has asked for yet is not in it, and the first request will be served fresh anyway.
     */
    const graph =
      (this as { environment?: { moduleGraph?: ModuleGraphLike } } | undefined)?.environment?.moduleGraph ??
      context.server?.moduleGraph;
    const sheetModule = graph?.getModuleById(file + SUFFIX);
    if (sheetModule === undefined || sheetModule === null || context.modules === undefined) return undefined;
    return [...context.modules, sheetModule];
  }

  /**
   * The project's config was SAVED, so everything it decided has to be decided again.
   *
   * `recompile` takes files that hold a block, and a config holds none. Without this, measured on a
   * running server, both halves are stale and both are silent:
   *
   * - `css-system/tokens.css` is written by `buildStart` and never again, so a token changed from
   *   `16px` to `40px` still served `16px`. It is a plain stylesheet the project imports once —
   *   nothing else was ever going to regenerate it.
   * - every already-compiled file kept the rules the OLD config gave it, so a narrowed `units` or a
   *   property switched off was not enforced until each file happened to be touched.
   *
   * The config is the file this package tells people to edit, so that is the one save that must not
   * be dropped.
   *
   * A config that does not READ is swallowed, exactly as a block that does not compile is on the
   * line below: a half-typed config is what one looks like for most of the time it is being edited,
   * and the transform reports it properly the moment anything asks for a file.
   */
  async function reconfigure(file: string, context: HotUpdate): Promise<void> {
    try {
      forgetGenerated();
      writeGenerated(dirname(file), ts);
    } catch {
      // Swallowed on purpose — see above. Nothing is invalidated, because nothing could be read.
      return;
    }

    /**
     * Every compiled file is DROPPED rather than recompiled here.
     *
     * Recompiling would mean deciding what to do with one that no longer compiles, in a hook whose
     * errors are swallowed — which is how a fault becomes invisible. Dropping is the same shape the
     * memo already has for a source save: the next transform compiles against the new config and
     * reports at the author's own line, which is where a diagnostic belongs.
     */
    for (const each of compiled.keys()) compiled.delete(each);

    const graph = context.server?.moduleGraph;
    if (graph === undefined) return;
    for (const each of styled) {
      const found = graph.getModuleById(each);
      if (found !== undefined && found !== null) graph.invalidateModule(found as never);
    }
  }

  /**
   * A file as the dependency scan needs it: parseable, with its imports. Only that, because all the
   * scan wants is the imports; a block the real transform would refuse is left alone rather than
   * thrown from, since a scan is not where an author should meet a diagnostic.
   */
  const scanned = (path: string): { code: string; loader: string } | null => {
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      return null;
    }
    if (!mayHoldABlock(source)) return null;

    try {
      const result = transform(source, { filename: path, runtime: options.runtime, read: readModule });
      return result === undefined ? null : { code: result.code, loader: loaderFor(path) };
    } catch {
      // The real transform reports it, at the author's own line. Twice is worse.
      return null;
    }
  };

  return {
    name: "ramonda-css",

    /**
     * Codegen, run once before anything is resolved.
     *
     * **Before**, because user code IMPORTS the generated module: run it lazily on the first file and
     * that import has already failed. So it happens at the start of the build, from the directory the
     * bundler was invoked in.
     *
     * From the project ROOT Vite reported, not from the process's directory — everything else here
     * finds a config by walking up from the FILE, which is what makes a monorepo work, and this is
     * the one question with no file to ask about. Vite is the thing that knows, so it is asked.
     */
    buildStart() {
      writeGenerated(root, ts);
    },

    /**
     * The dependency SCAN is a second pass, and it never sees this plugin.
     *
     * Vite pre-bundles a project's dependencies by walking its entries with **esbuild**, and that
     * walk has its own plugin list — `transform` above is Rollup's and is not consulted. Without
     * this, `pnpm dev` fails the scan with *Expected identifier but found "@"* on every file
     * holding a block — then *Skipping dependency pre-bundling*, so every bare import is served
     * unbundled and the page loads hundreds of modules or breaks outright.
     *
     * So the same transform is handed to it here. It only has to make the file PARSE, because all
     * the scan wants is the imports; a block that the real transform would refuse is left alone
     * rather than thrown from, since a scan is not where an author should meet a diagnostic.
     */
    config(userConfig, environment) {
      // Vite's own `isProduction` is exactly this, and it is the answer a config asks for.
      production = environment?.mode === "production";
      developing = environment?.command === "serve" && environment.mode !== "test" && process.env.VITEST === undefined;
      building = environment?.command === "build";
      // The project's root, for the one question with no file to ask about — see `buildStart`.
      root = (userConfig as { root?: string } | undefined)?.root ?? root;
      /**
       * A stylesheet's source map reaches the browser only with `css.devSourcemap`, which Vite leaves
       * off. Turned on for the dev server unless the project said otherwise, so a browser's style
       * panel names the `.tsx` line beside each rule — see `load`.
       */
      const devSourcemap = (userConfig as { css?: { devSourcemap?: boolean } } | undefined)?.css?.devSourcemap;
      /**
       * Vite 8 walks the entries with Rolldown, and reads `esbuildOptions` only to translate it, with
       * a warning on every start. So each is handed the scan in its own shape. The version is Vite's
       * own `this.meta.viteVersion`; a caller that sets none is answered as Vite 7.
       */
      const version = (this as { meta?: { viteVersion?: string } } | undefined)?.meta?.viteVersion;
      const major = Number.parseInt(version ?? "7", 10);
      const optimizeDeps =
        major >= 8
          ? {
              rolldownOptions: {
                plugins: [
                  {
                    name: "ramonda-css:scan",
                    load: {
                      filter: { id: SCRIPT },
                      handler(id: string) {
                        // A filter has to be a RegExp; the question every consumer asks is this.
                        if (!fileMayHoldABlock(id)) return null;
                        const result = scanned(id);
                        return result === null ? null : { code: result.code, moduleType: result.loader };
                      },
                    },
                  },
                ],
              },
            }
          : {
              esbuildOptions: {
                plugins: [
                  {
                    name: "ramonda-css:scan",
                    setup(build: ScanBuild) {
                      build.onLoad({ filter: SCRIPT }, (args: { path: string }) => {
                        if (!fileMayHoldABlock(args.path)) return null;
                        const result = scanned(args.path);
                        return result === null ? null : { contents: result.code, loader: result.loader };
                      });
                    },
                  },
                ],
              },
            };
      return {
        ...(devSourcemap === undefined ? { css: { devSourcemap: true } } : {}),
        optimizeDeps,
      };
    },
    /** See the note above: this is what puts the transform before esbuild. Measured, not assumed. */
    enforce: "pre",

    /**
     * Claimed here, or Vite tries to read `Card.tsx.ramonda-css.css` off the disk and fails. The
     * name is returned unchanged because it already carries the real path, which is what makes the
     * graph put the stylesheet beside the file it belongs to.
     */
    resolveId(id) {
      return id.endsWith(SUFFIX) ? id : null;
    },

    /**
     * A file's stylesheet — and in development its source map, which points each rule at the
     * declaration that wrote it. The file's text goes into the map, so the browser shows it without
     * asking the server for a path it may not serve. A build writes one sheet and needs neither.
     */
    load(id) {
      if (!id.endsWith(SUFFIX)) return null;
      const file = id.slice(0, -SUFFIX.length);
      if (production || building) return sheet.cssFor(file);
      let content: string | undefined;
      try {
        content = readFileSync(file, "utf8");
      } catch {
        content = undefined;
      }
      const { css, map } = sheet.cssWithMapFor(file, content);
      return { code: css, map };
    },

    transform(this: unknown, code, id) {
      // Our own stylesheet, coming back round. Read by `load` and never transformed.
      if (id.endsWith(SUFFIX)) return null;

      const file = id.split("?")[0];
      if (file.endsWith(".css") && !file.includes("node_modules") && !id.startsWith("\0")) {
        checkStylesheet(file, code);
        return null;
      }
      // A query string is Vite's — `?used`, `?v=hash`, `?worker`. A file skipped because of one is a
      // file whose blocks silently do not compile.
      if (!fileMayHoldABlock(file) || file.includes("node_modules") || id.startsWith("\0")) return null;

      const result = compile(file, code);
      if (result === undefined) return null;

      /**
       * The import that carries this file's rules, appended rather than prepended: the CSS is applied
       * to elements this module creates, and a stylesheet's own position in the file decides nothing
       * about that. Appending leaves every source position — and therefore the map — untouched.
       */
      const own = sheet.cssFor(file);
      /**
       * The import that carries the project's declared TOKENS, beside the one carrying its rules.
       *
       * The generated `:root` is written to disk, and with nothing importing it
       * `var(--color-accent-main)` resolves to its registered initial value and nothing else:
       * correct classes, unstyled page.
       *
       * Emitted beside the block import rather than asked of the project, for the same reason
       * codegen runs itself: a line a project has to remember is a line most projects will not
       * have. Both bundlers dedupe an import by path, so the declarations arrive once however many
       * modules ask for them.
       */
      const declared = variablesSheetFor(file);
      const code2 =
        own === ""
          ? result.code
          : `${result.code}\n` +
            `${declared === undefined ? "" : `import ${JSON.stringify(declared)};\n`}` +
            `import ${JSON.stringify(file + SUFFIX)};\n`;

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
     * emitted JavaScript, so a minifier that renames or drops a rule ships a page pointing at a
     * class that is not in the stylesheet. Nothing throws, the page renders unstyled, and there is
     * nothing to blame it on. Merging is allowed and keeps the name — `.a,.r-… { … }` — so the
     * question is only whether the name survived, which is what a rename or a drop destroys and
     * nothing else does.
     *
     * **Every CSS asset at once, and none is not a failure.** A rule may land in any chunk, so the
     * check is against the concatenation. And a build that emitted no stylesheet at all is not
     * evidence of anything — an SSR build is the ordinary case, where the client build is what
     * writes the CSS — so there is nothing to check rather than everything to report.
     *
     * **The variables are asked about first, and that is not the same question.** It is about what
     * the source READS, so it holds whether or not an asset was emitted — and asked after the
     * return above, a build with no stylesheet would skip it while the esbuild adapter did not.
     */
    generateBundle(_options, bundle) {
      // Every file is in, so the question no single file can answer is answerable now.
      sheet.verifyVariables();

      const sheets = Object.values(bundle).filter(
        (output) => output.type === "asset" && typeof output.source === "string" && output.fileName?.endsWith(".css"),
      );
      if (sheets.length === 0) return;

      sheet.verify(
        sheets.map((output) => output.source as string).join("\n"),
        sheets.map((output) => output.fileName).join(", "),
      );
    },
  };
}
