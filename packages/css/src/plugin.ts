import type ts from "typescript";
import { type Span, readBlock } from "./compiler/read";
import { type Finding, checkBlock, checkSite } from "./compiler/rules";
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
        {
          version: string;
          file: VirtualFile | undefined;
          css: Finding[];
          /** What an editor can act on and a build must not fail over. Drawn as suggestions. */
          hints: Finding[];
          author: ts.SourceFile | undefined;
          /** Where the CSS is and where the holes are — read once per version, asked on every paint. */
          where: { blocks: Span[]; holes: Span[] };
        }
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

        cache.set(fileName, {
          version,
          file,
          author,
          css: text === undefined ? [] : cssFindings(text),
          hints: text === undefined ? [] : siteFindings(text),
          where: regions(text ?? ""),
        });
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

      /** What is true of the site rather than of its CSS, drawn as a suggestion. See `checkSite`. */
      const hintsFor = (fileName: string): ts.Diagnostic[] => {
        overlay(fileName, readSnapshot);
        const cached = cache.get(fileName);
        return cached === undefined ? [] : ours(cached.hints, cached.author, 2 as ts.DiagnosticCategory);
      };

      /**
       * Everything the service can do, with the virtual text underneath and positions mapped at the
       * boundary.
       *
       * The earlier version of this comment claimed a fall-through answers about the author's own
       * file. It does not, and the belief cost the whole position surface: the host is patched IN
       * PLACE, so the service reads the virtual text for every question anyone asks. An unmapped
       * answer is an offset into text nobody wrote — and since the shift is the same for the whole
       * file, it is just as wrong ABOVE a block as inside one.
       *
       * So every answer carrying a position is mapped, and the ones that carry an EDIT are refused:
       * an edit computed against the virtual text would write scaffolding into the author's file.
       * What falls through now is only what carries no position at all.
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
        return [
          ...ours,
          ...hintsFor(fileName),
          ...withoutRepeats(ours, mapped(file, service.getSemanticDiagnostics(fileName))),
        ];
      };

      /**
       * The colours an editor paints OVER the grammar's, and the reason they were wrong everywhere.
       *
       * An editor paints twice: a TextMate grammar first, then semantic tokens from the language
       * service on top. Those tokens are spans, the service is reading the virtual file, and the
       * preamble alone is hundreds of characters — so applied to the author's text at face value,
       * every colour in the file lands on the wrong characters. Measured on a four-line file, the
       * spans sliced out `\nconst `, ` = <div css=` and `before, a, af`.
       *
       * It is invisible to every other test here, because a diagnostic is mapped and a colour is
       * not, and it is worst ABOVE a block: the shift is the same for the whole file, so code with
       * nothing to do with a block is painted just as wrongly.
       *
       * The whole virtual file is asked about rather than the author's range, because a range cannot
       * be converted — one author range is several virtual ones, with scaffolding in between. The
       * answer is mapped back and then cut to what was asked for.
       */
      proxy.getEncodedSemanticClassifications = (fileName, span, format) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getEncodedSemanticClassifications(fileName, span, format);

        const got = service.getEncodedSemanticClassifications(fileName, { start: 0, length: file.code.length }, format);
        return { ...got, spans: home(file, got.spans, span, cache.get(fileName)?.where ?? { blocks: [], holes: [] }) };
      };

      /** Folding, and the outline that feeds the breadcrumbs — both are spans and both were wrong. */
      proxy.getOutliningSpans = (fileName) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getOutliningSpans(fileName);

        const out: ts.OutliningSpan[] = [];
        for (const span of service.getOutliningSpans(fileName)) {
          const textSpan = back(file, span.textSpan);
          const hintSpan = back(file, span.hintSpan);
          if (textSpan === undefined || hintSpan === undefined) continue;
          out.push({ ...span, textSpan, hintSpan });
        }
        return out;
      };

      proxy.getNavigationTree = (fileName) => {
        const file = overlay(fileName, readSnapshot);
        return file === undefined
          ? service.getNavigationTree(fileName)
          : tree(file, service.getNavigationTree(fileName));
      };

      proxy.getNavigationBarItems = (fileName) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getNavigationBarItems(fileName);
        return bar(file, service.getNavigationBarItems(fileName));
      };

      /**
       * Going somewhere, and seeing where a name is used.
       *
       * Every one of these answers about a SET of files, and only the one this plugin overlays is
       * virtual — an entry in another file already has the position it should. So the mapping is by
       * file name rather than across the board, which is the difference between a reference list
       * that works and one that quietly relocates half of itself.
       */
      const goingTo =
        <T extends { fileName: string; textSpan: ts.TextSpan; contextSpan?: ts.TextSpan }>(
          run: (fileName: string, at: number) => readonly T[] | undefined,
        ) =>
        (fileName: string, position: number): T[] | undefined => {
          const file = overlay(fileName, readSnapshot);
          if (file === undefined) return run(fileName, position)?.slice();

          const at = file.virtualOf(position);
          if (at === undefined) return undefined;
          const got = run(fileName, at);
          return got === undefined ? undefined : elsewhere(file, fileName, got);
        };

      proxy.getDefinitionAtPosition = goingTo((name, at) => service.getDefinitionAtPosition(name, at));
      proxy.getTypeDefinitionAtPosition = goingTo((name, at) => service.getTypeDefinitionAtPosition(name, at));
      proxy.getImplementationAtPosition = goingTo((name, at) => service.getImplementationAtPosition(name, at));
      proxy.getReferencesAtPosition = goingTo((name, at) => service.getReferencesAtPosition(name, at));

      proxy.getDefinitionAndBoundSpan = (fileName, position) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getDefinitionAndBoundSpan(fileName, position);

        const at = file.virtualOf(position);
        if (at === undefined) return undefined;
        const got = service.getDefinitionAndBoundSpan(fileName, at);
        if (got === undefined) return undefined;

        const textSpan = back(file, got.textSpan);
        if (textSpan === undefined) return undefined;
        return {
          textSpan,
          definitions: got.definitions === undefined ? undefined : elsewhere(file, fileName, got.definitions),
        };
      };

      proxy.getDocumentHighlights = (fileName, position, filesToSearch) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getDocumentHighlights(fileName, position, filesToSearch);

        const at = file.virtualOf(position);
        if (at === undefined) return undefined;
        const got = service.getDocumentHighlights(fileName, at, filesToSearch);
        if (got === undefined) return undefined;

        return got.map((one) =>
          one.fileName !== fileName
            ? one
            : {
                ...one,
                highlightSpans: one.highlightSpans.flatMap((span) => {
                  const textSpan = back(file, span.textSpan);
                  return textSpan === undefined ? [] : [{ ...span, textSpan }];
                }),
              },
        );
      };

      proxy.getSignatureHelpItems = (fileName, position, options) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getSignatureHelpItems(fileName, position, options);

        const at = file.virtualOf(position);
        if (at === undefined) return undefined;
        const got = service.getSignatureHelpItems(fileName, at, options);
        if (got === undefined) return undefined;

        const applicableSpan = back(file, got.applicableSpan);
        return applicableSpan === undefined ? undefined : { ...got, applicableSpan };
      };

      /**
       * What an editor CHANGES, and the one place refusing beats answering.
       *
       * An edit is computed against the virtual text: its range is an offset nobody wrote, and its
       * new text can be the scaffolding itself. Applied to the author's file it does not misplace a
       * colour, it corrupts the source. Formatting these files is `ramonda-css format`'s job, and
       * biome refuses them for the same reason — the syntax is not TypeScript.
       */
      /** True when this file is one we overlay, and so one whose offsets are not the author's. */
      const overlaid = (fileName: string) => overlay(fileName, readSnapshot) !== undefined;

      proxy.getFormattingEditsForDocument = (fileName, options) =>
        overlaid(fileName) ? [] : service.getFormattingEditsForDocument(fileName, options);

      proxy.getFormattingEditsForRange = (fileName, start, end, options) =>
        overlaid(fileName) ? [] : service.getFormattingEditsForRange(fileName, start, end, options);

      proxy.getFormattingEditsAfterKeystroke = (fileName, position, key, options) =>
        overlaid(fileName) ? [] : service.getFormattingEditsAfterKeystroke(fileName, position, key, options);

      proxy.getCodeFixesAtPosition = (fileName, start, end, codes, options, preferences) =>
        overlaid(fileName) ? [] : service.getCodeFixesAtPosition(fileName, start, end, codes, options, preferences);

      proxy.getApplicableRefactors = (fileName, position, preferences, reason, kind, interactive) =>
        overlaid(fileName)
          ? []
          : service.getApplicableRefactors(fileName, position, preferences, reason, kind, interactive);

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
function ours(
  findings: readonly Finding[],
  file: ts.SourceFile | undefined,
  /**
   * A warning, which is the honest answer for the four that read the CSS: a page with
   * `display: flexx` renders, and the declaration is simply dropped. `1` is `Error`, `0` is
   * `Warning`, `2` is `Suggestion` — which is what the one about colours gets, because nothing is
   * wrong with the code and a squiggle would be claiming otherwise.
   */
  category = 0 as ts.DiagnosticCategory,
): ts.Diagnostic[] {
  return findings.map((finding) => ({
    file,
    start: finding.at,
    length: finding.length,
    category,
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

/** What is true of the SITE rather than of the CSS in it — see `checkSite`. */
function siteFindings(text: string): Finding[] {
  return findBlocks(text).flatMap((site) => checkSite(text, site));
}

/**
 * Where a block runs in the author's file, and where its holes run inside it.
 *
 * Both are needed to answer one question — is this position the grammar's or TypeScript's? — and
 * the hole is why the block's own range is not enough: a hole IS TypeScript, and `this.weight`
 * inside one has to read the way it reads anywhere else.
 */
function regions(text: string): { blocks: Span[]; holes: Span[] } {
  const blocks: Span[] = [];
  const holes: Span[] = [];
  for (const site of findBlocks(text)) {
    const read = readBlock(text, site.open, "", { tolerant: true });
    blocks.push({ start: site.open, end: read.end });
    holes.push(...read.holes);
  }
  return { blocks, holes };
}

/** True when the position belongs to the CSS itself — inside a block, outside every hole. */
function isCss({ blocks, holes }: { blocks: readonly Span[]; holes: readonly Span[] }, at: number): boolean {
  const inBlock = blocks.some((span) => span.start <= at && at < span.end);
  return inBlock && !holes.some((span) => span.start <= at && at < span.end);
}

/** A span in virtual coordinates, in the author's — or nothing, when it names text they never wrote. */
function back(file: VirtualFile, span: ts.TextSpan | undefined): ts.TextSpan | undefined {
  return span === undefined ? undefined : file.spanOf(span.start, span.length);
}

/**
 * An outline item and its children, moved home, with this package's own scaffolding left out.
 *
 * The scaffolding is not a detail here: the virtual file declares `__block`, and an outline listing
 * it beside the author's own names is a lie about what the file contains. An item whose span maps
 * nowhere is exactly that item, so dropping the unmappable is the whole filter.
 */
function tree(file: VirtualFile, item: ts.NavigationTree): ts.NavigationTree {
  return {
    ...item,
    spans: spansHome(file, item.spans),
    nameSpan: item.nameSpan === undefined ? undefined : back(file, item.nameSpan),
    childItems: item.childItems?.flatMap((child) => {
      const moved = tree(file, child);
      return moved.spans.length === 0 ? [] : [moved];
    }),
  };
}

/** The flat outline, the same way. */
function bar(file: VirtualFile, items: readonly ts.NavigationBarItem[]): ts.NavigationBarItem[] {
  return items.flatMap((item) => {
    const spans = spansHome(file, item.spans);
    return spans.length === 0 ? [] : [{ ...item, spans, childItems: bar(file, item.childItems ?? []) }];
  });
}

/** Spans that survive the move; the ones that do not were never the author's. */
function spansHome(file: VirtualFile, spans: readonly ts.TextSpan[]): ts.TextSpan[] {
  return spans.flatMap((span) => {
    const moved = back(file, span);
    return moved === undefined ? [] : [moved];
  });
}

/**
 * Entries that may live in any file, with only the overlaid one's positions moved.
 *
 * An entry in another file already holds the position it should — mapping it would relocate a
 * reference that was never virtual.
 */
function elsewhere<T extends { fileName: string; textSpan: ts.TextSpan; contextSpan?: ts.TextSpan }>(
  file: VirtualFile,
  fileName: string,
  entries: readonly T[],
): T[] {
  return entries.flatMap((entry) => {
    if (entry.fileName !== fileName) return [entry];

    const textSpan = back(file, entry.textSpan);
    if (textSpan === undefined) return [];
    return [{ ...entry, textSpan, contextSpan: back(file, entry.contextSpan) }];
  });
}

/**
 * Encoded classification triples — `[start, length, kind]` — moved back to the author's file.
 *
 * A triple that maps nowhere is the scaffolding's own and is dropped rather than guessed at: a
 * colour on `__block` would be a colour on a character the author never wrote. What survives is cut
 * to the range the editor asked about, which is usually the part of the file it can see.
 */
function home(
  file: VirtualFile,
  spans: readonly number[],
  asked: ts.TextSpan,
  where: { blocks: readonly Span[]; holes: readonly Span[] },
): number[] {
  const out: number[] = [];
  for (let i = 0; i + 2 < spans.length; i += 3) {
    const span = file.spanOf(spans[i], spans[i + 1]);
    if (span === undefined) continue;
    if (span.start + span.length <= asked.start || span.start >= asked.start + asked.length) continue;
    /**
     * Inside a block the grammar is the authority, and TypeScript's opinion is not redundant but
     * wrong. Measured in a real editor: `display` came out white and `flex-direction` blue in the
     * same block, because one is a bare key in the virtual file and gets a token while the other has
     * to be quoted and gets none. A CSS property painted as a TypeScript property, at random.
     */
    if (isCss(where, span.start)) continue;
    out.push(span.start, span.length, spans[i + 2]);
  }
  return out;
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
