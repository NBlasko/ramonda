import { CssBlockError } from "./compiler/errors";
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
 * Dedupe survives it: the first file to claim a class owns the rule, and a second file naming the
 * same block emits nothing for it.
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
export interface CssPluginLike {
  name: string;
  enforce: "pre";
  resolveId(this: unknown, id: string): string | null;
  load(this: unknown, id: string): string | null;
  transform(this: unknown, code: string, id: string): { code: string; map: SourceMap } | null;
}

/** The bits of Vite's plugin context this reaches for, all optional. */
interface PluginContext {
  server?: {
    moduleGraph: { getModuleById(id: string): unknown };
    reloadModule(module: never): void;
  };
}

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
   * One sheet per plugin instance, and the plugin is created per Vite config — so a dev server and a
   * build in the same process do not share one, and neither do two Vitest projects.
   */
  const sheet = new Sheet();
  /** Files that currently contribute rules, so a file losing its last block is noticed. */
  const styled = new Set<string>();

  return {
    name: "ramonda-css",
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

      let result: ReturnType<typeof transform>;
      try {
        result = transform(code, { filename: file, runtime: options.runtime });
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

      /**
       * A file with NO blocks is still told to the sheet, and only if it had some before.
       *
       * Found by a failing test: returning early here meant an author who deleted the last block
       * from a file left its rules in the sheet for the life of the dev server — and, worse, left the
       * class NAME claimed, so re-adding an edited block collided with the one it used to be.
       *
       * `styled` is what makes it free: a file that never had a block is the overwhelming majority
       * and is not looked up at all.
       */
      if (result === undefined) {
        if (!styled.has(file)) return null;
        styled.delete(file);
        for (const changed of sheet.add(file, [])) reload(this as PluginContext, changed + SUFFIX);
        return null;
      }

      styled.add(file);

      /**
       * Every file whose CSS moved, which is not only this one: a file that stops using a block hands
       * ownership of that rule to whoever else still names it, and a dev server has no way to know
       * that unless it is told.
       */
      for (const changed of sheet.add(file, result.blocks)) {
        if (changed !== file) reload(this as PluginContext, changed + SUFFIX);
      }

      /**
       * The import that carries this file's rules, appended rather than prepended: the CSS is applied
       * to elements this module creates, and a stylesheet's own position in the file decides nothing
       * about that. Appending leaves every source position — and therefore the map — untouched.
       */
      const own = sheet.cssFor(file);
      const code2 = own === "" ? result.code : `${result.code}\nimport ${JSON.stringify(file + SUFFIX)};\n`;

      return { code: code2, map: result.map };
    },
  };
}

/**
 * Tells the dev server one file's stylesheet moved.
 *
 * The file whose JavaScript Vite just read needs no telling — its stylesheet is reloaded along with
 * it. This is for the OTHER files, the ones that gained or lost a rule because somebody else's file
 * changed, and which nothing in the graph connects to the edit.
 */
function reload(context: PluginContext, id: string): void {
  const server = context.server;
  if (server === undefined) return;
  const module = server.moduleGraph.getModuleById(id);
  if (module !== undefined && module !== null) server.reloadModule(module as never);
}
