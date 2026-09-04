import type ts from "typescript";
import { readBlock } from "./compiler/read";
import { type Finding, checkBlock } from "./compiler/rules";
import { findBlocks } from "./compiler/scan";
import { type VirtualFile, virtualFile } from "./compiler/virtual";

/**
 * The TypeScript language service plugin: what makes a block writable rather than merely correct.
 *
 * ```json
 * { "compilerOptions": { "plugins": [{ "name": "@ramonda/css/plugin" }] } }
 * ```
 *
 * Everything an editor asks — completion, hover, go-to-definition, the red squiggles — it asks the
 * language service, about a file the compiler cannot parse. So the service is handed the virtual file
 * instead, and every position crossing the boundary is mapped: a caret goes in, a span comes back.
 *
 * **Without this the feature is technically safe and practically unusable.** A type that is only
 * enforced by a command is a type nobody meets until CI.
 *
 * ## It is CommonJS, and that is measured rather than conventional
 *
 * `tsserver` loads a plugin with a synchronous `require` and then checks
 * `typeof pluginModuleFactory === "function"`. On Node 24 `require()` of an ESM module works — but it
 * returns the module NAMESPACE, an object, not the default export. So an ESM-only plugin is **silently
 * skipped**: "did not expose a proper factory function", logged at info level, where nobody reads it.
 *
 * Hence `dist/plugin.cjs`, built as CommonJS with `module.exports` set to the factory. This file is
 * that factory's source; the build is what makes it loadable.
 *
 * ## Completion needs the caret INSIDE the token
 *
 * Measured on a plain object literal, which is what a block becomes: inside a half-typed key gives
 * the property names, inside a half-typed value gives the value union, and immediately after a
 * complete key gives one useless entry. That is why the mapping lands inside rather than at an edge —
 * see `virtualOf`.
 *
 * ## And it reads a HALF-WRITTEN block
 *
 * The strict parser refuses `disp`, and `disp` is the state you are in while typing `display`. So the
 * virtual file here is the tolerant one, and the nine caret positions a person passes through were
 * measured one at a time — including an empty block, which needed an empty object literal to exist
 * for the caret to be inside anything at all.
 */

/** What `tsserver` hands the factory. Structural, so `typescript` stays a peer and not an import. */
export interface PluginCreateInfo {
  languageService: ts.LanguageService;
  languageServiceHost: ts.LanguageServiceHost;
  config?: { properties?: string };
}

export interface PluginModule {
  create(info: PluginCreateInfo): ts.LanguageService;
}

/** Only these are source. Everything else is somebody else's file. */
const SOURCE = /\.[cm]?[jt]sx?$/;

export function init(modules: { typescript: typeof ts }): PluginModule {
  const tsModule = modules.typescript;

  return {
    create(info) {
      const host = info.languageServiceHost;
      const service = info.languageService;

      /**
       * File → its virtual copy, kept until the file's version changes.
       *
       * The version is the editor's own answer to "has this changed", so it is the right key: a
       * keystroke bumps it, and everything else — a project reload, another file's edit — does not.
       */
      const cache = new Map<
        string,
        { version: string; file: VirtualFile | undefined; css: Finding[]; author: ts.SourceFile | undefined }
      >();

      /** The host's own reader, kept before it is replaced — or the overlay would ask itself. */
      const readSnapshot = host.getScriptSnapshot.bind(host);

      const overlay = (
        fileName: string,
        read: (name: string) => ts.IScriptSnapshot | undefined,
      ): VirtualFile | undefined => {
        if (!SOURCE.test(fileName)) return undefined;

        const version = host.getScriptVersion(fileName);
        const cached = cache.get(fileName);
        if (cached !== undefined && cached.version === version) return cached.file;

        // The ORIGINAL reader, or this would ask itself for the text it is about to replace.
        const snapshot = read(fileName);
        const text = snapshot?.getText(0, snapshot.getLength());

        /**
         * No `try`, deliberately. The tolerant reading recovers from everything the strict one
         * refuses — that is what it is for — so there is nothing here to catch. A `catch` would be
         * pretending to handle a case that cannot arise, and would swallow a real bug in this
         * package into an editor that quietly stops understanding the syntax.
         */
        const file =
          text === undefined ? undefined : virtualFile(text, { properties: properties(info), tolerant: true });

        /**
         * The author's own text as a source file, for the CSS rules' diagnostics to hang on.
         *
         * The inner service's source file holds the VIRTUAL text, and a diagnostic's `file` is what
         * an editor resolves a position against — so attaching an author offset to the virtual text
         * would put a squiggle wherever the two happen to differ. One per version, beside the copy
         * it is the counterpart to.
         */
        const author =
          text === undefined
            ? undefined
            : tsModule.createSourceFile(fileName, text, tsModule.ScriptTarget.Latest, true, tsModule.ScriptKind.TSX);

        cache.set(fileName, { version, file, author, css: text === undefined ? [] : cssFindings(text) });
        return file;
      };

      /**
       * The host is patched IN PLACE, and a second language service is not built.
       *
       * That was the first design and it does not work: `Object.create(host)` over a `tsserver`
       * project gives a host whose language service has no program at all — measured through a real
       * `tsserver`, every completion came back `Cannot read properties of undefined (reading
       * 'getSourceFile')`. A project is not a plain object, and what a service needs from one does
       * not survive being shadowed.
       *
       * Patching the one method is what a plugin of this kind does, and it is better anyway:
       * `tsserver`'s own service reads the virtual text, so there is ONE program rather than two, and
       * everything the proxy does not override is already answering about the right file.
       *
       * The file NAME is unchanged, so an import resolves from where the file really is and nothing
       * about module resolution moves.
       */
      host.getScriptSnapshot = (fileName) => {
        const file = overlay(fileName, readSnapshot);
        return file === undefined ? readSnapshot(fileName) : tsModule.ScriptSnapshot.fromString(file.code);
      };

      /** The CSS rules' findings for a file, out of the same cache the overlay uses. */
      const cssFor = (fileName: string): ts.Diagnostic[] => {
        overlay(fileName, readSnapshot);
        const cached = cache.get(fileName);
        return cached === undefined ? [] : ours(cached.css, cached.author);
      };

      /**
       * Everything the service can do, with the virtual text underneath and positions mapped at the
       * boundary. What is not listed falls through to the real service, which is reading the author's
       * own file — right for anything that does not carry a position, and honest for the rest: an
       * answer about the file on disk beats no answer.
       */
      const proxy: ts.LanguageService = Object.create(service);

      proxy.getCompletionsAtPosition = (fileName, position, options, settings) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getCompletionsAtPosition(fileName, position, options, settings);

        const at = file.virtualOf(position);
        if (at === undefined) return undefined;

        const got = service.getCompletionsAtPosition(fileName, at, options, settings);
        if (got === undefined) return undefined;

        return {
          ...got,
          entries: got.entries.map((entry) => ({
            ...entry,
            replacementSpan: back(file, entry.replacementSpan),
          })),
        };
      };

      proxy.getQuickInfoAtPosition = (fileName, position) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getQuickInfoAtPosition(fileName, position);

        const at = file.virtualOf(position);
        if (at === undefined) return undefined;

        /**
         * Asked again at the DECLARATION when the caret's own position has nothing to say.
         *
         * A value and a selector both become string literals, and TypeScript answers nothing about a
         * position inside one — measured, hover over `column;` and over `&:hover` came back empty.
         * The declaration is what a reader was asking about anyway: hovering a value shows the
         * property it belongs to, its grammar and its initial value.
         */
        const got =
          service.getQuickInfoAtPosition(fileName, at) ?? quickInfoAt(service, fileName, file.declarationOf(position));

        return got === undefined ? undefined : { ...got, textSpan: back(file, got.textSpan) ?? got.textSpan };
      };

      proxy.getSemanticDiagnostics = (fileName) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getSemanticDiagnostics(fileName);

        /**
         * The CSS rules beside the type errors, and this is where the hole rule earns its place: the
         * build refuses a hole written where a custom property cannot go, and here it is a squiggle
         * under the character, while it is being typed.
         */
        const ours = cssFor(fileName);
        return [...ours, ...withoutRepeats(ours, mapped(file, service.getSemanticDiagnostics(fileName)))];
      };

      /**
       * Syntactic diagnostics come from the virtual file too, and they have to: the author's file does
       * not parse as TypeScript at all, so the real service reports the block itself as a syntax
       * error — a red squiggle on correct code, which is the loudest possible way to be wrong.
       */
      proxy.getSyntacticDiagnostics = (fileName) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getSyntacticDiagnostics(fileName);

        return mapped(file, service.getSyntacticDiagnostics(fileName)) as ts.DiagnosticWithLocation[];
      };

      return proxy;
    },
  };
}

/**
 * The CSS rules' findings, as diagnostics an editor can draw.
 *
 * Their positions are already the author's — the rules read the author's own text, not the virtual
 * copy — so nothing is mapped. The category is a warning rather than an error, which is the honest
 * answer for all four: a page with `display: flexx` renders, and the declaration is dropped.
 */
function ours(findings: readonly Finding[], file: ts.SourceFile | undefined): ts.Diagnostic[] {
  return findings.map((finding) => ({
    file,
    start: finding.at,
    length: finding.length,
    // A warning, which is the honest answer for all four: a page with `display: flexx` renders, and
    // the declaration is simply dropped. `1` is `Error`, `0` is `Warning`.
    category: 0 as ts.DiagnosticCategory,
    // Zero, because these are not TypeScript's and claiming a code in its space would be a lie. The
    // rule's id is in the message, which is what a reader searches for.
    code: 0,
    messageText: `[${finding.rule}] ${finding.message}`,
  }));
}

/**
 * The compiler's diagnostics, minus the ones a rule of ours already said better.
 *
 * `TS2353` is *"does not exist in type"*, which is exactly what `unknown-property` says — and the
 * rule says it with the near miss the compiler cannot offer, because a QUOTED object key gets none.
 * `ramonda-css` has dropped the duplicate since it was written; measured through a real `tsserver`,
 * the editor was still showing both, so one fault read as two.
 *
 * Matched on POSITION, the way the command does it: the same fault at the same character is the same
 * fault, and a `TS2353` about a nested rule's key is at a position no property rule names.
 */
function withoutRepeats(ours: readonly ts.Diagnostic[], theirs: readonly ts.Diagnostic[]): ts.Diagnostic[] {
  const said = new Set(
    ours
      .filter((diagnostic) => String(diagnostic.messageText).startsWith("[unknown-property]"))
      .map((diagnostic) => diagnostic.start),
  );

  return theirs.filter((diagnostic) => !(diagnostic.code === 2353 && said.has(diagnostic.start)));
}

/** Quick info at a position, or nothing when there is no position to ask about. */
function quickInfoAt(service: ts.LanguageService, fileName: string, at: number | undefined) {
  return at === undefined ? undefined : service.getQuickInfoAtPosition(fileName, at);
}

/** Where the block shape lives, so a project can point it at a fixture or at a wrapper's own. */
function properties(info: PluginCreateInfo): string | undefined {
  return info.config?.properties;
}

/**
 * What the CSS rules say about a file, read from the author's own text.
 *
 * TOLERANT, because an editor is the only place the hole rule can fire at all: the build refuses
 * such a block outright, so by the time a build has spoken there is nothing left to squiggle.
 */
function cssFindings(text: string): Finding[] {
  const out: Finding[] = [];
  for (const site of findBlocks(text)) {
    out.push(...checkBlock(readBlock(text, site.open, "", { tolerant: true }).block));
  }
  return out;
}

/** A span in virtual coordinates, in the author's — or nothing, when it names text they never wrote. */
function back(file: VirtualFile, span: ts.TextSpan | undefined): ts.TextSpan | undefined {
  return span === undefined ? undefined : file.spanOf(span.start, span.length);
}

/**
 * Diagnostics whose positions are the author's, with the scaffolding's own dropped.
 *
 * A diagnostic about `__block` is about the file this wrote. The preamble is the exception the check
 * command makes — a block shape that cannot be resolved means nothing is checked — and it is
 * deliberately NOT made here: an editor shows a project-wide setup fault on every file it opens, and
 * `ramonda-css` is the place that says it once.
 */
function mapped<T extends ts.Diagnostic>(file: VirtualFile, diagnostics: readonly T[]): T[] {
  const out: T[] = [];
  for (const diagnostic of diagnostics) {
    /**
     * `start` is optional on the type and always present here: both callers ask about ONE file, and
     * a diagnostic about a file has a position in it. A project-wide one — an option the compiler
     * rejects — comes from `getCompilerOptionsDiagnostics`, which this does not touch.
     */
    const span = back(file, { start: diagnostic.start ?? 0, length: diagnostic.length ?? 0 });
    if (span === undefined) continue;
    out.push({ ...diagnostic, start: span.start, length: span.length });
  }
  return out;
}
