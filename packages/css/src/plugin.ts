import type ts from "typescript";
import type { BlockItem } from "./compiler/ast";
import {
  PROPERTIES,
  PROPERTY_NAMED,
  UNION_TYPED,
  VALUE_WORDS,
  SELECTORS,
  AT_RULE_LINKS,
} from "./compiler/keywords.generated";
import { type Span, readBlock } from "./compiler/read";
import { type Finding, checkBlock, checkSite, checkText } from "./compiler/rules";
import { findBlocks } from "./compiler/scan";
import { type VirtualFile, virtualFile } from "./compiler/virtual";
import { type Config, configReader, environmentOf } from "./config";
import { warnIfStale } from "./stale";
import { type Imported, namedSites, syntaxesIn } from "./compiler/references";

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
  /**
   * tsserver's own log, when there is one — the only place a plugin can say anything.
   *
   * Declared rather than imported, like every other piece of tsserver's shape here, and declared
   * OPTIONAL at every level: a test builds this object by hand, and a plugin that needed a logger to
   * exist would refuse to start under one.
   */
  project?: { projectService?: { logger?: { info?: (message: string) => void } } };
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
          /** Where the CSS, the holes and the values are — read once per version, asked on every paint. */
          where: Regions;
          /**
           * Every module this file READ a named site from, and the version each had.
           *
           * The file's own version is not enough once a block can resolve a token from elsewhere: the
           * answer is derived from the other module's TEXT, so editing the theme changes what this
           * file means without touching this file. Measured when cross-module resolution was first
           * written — the editor kept saying a token existed after it had been deleted.
           */
          read: { name: string; version: string }[];
        }
      >();

      /** The host's own reader, kept before it is replaced — or the overlay would ask itself. */
      const readSnapshot = host.getScriptSnapshot.bind(host);

      /**
       * A module a block imports a named site from, read out of the EDITOR rather than off the disk.
       *
       * This is the whole reason {@link Imported.read} is injected. A generated name is a hash of the
       * declaring module's text, so a build reading the saved file and an editor reading the same
       * path would agree only while the file is saved — and the moment somebody edits a token
       * without saving, the editor would name it one thing and the build another, and every
       * squiggle about it would be about a file that does not exist.
       *
       * `resolveModuleName` rather than a path guess, because the host has the project's real
       * settings; the build guesses extensions only because it has no host to ask.
       *
       * **Known limit, and it is the cache rather than this**: an overlay is keyed by ITS file's
       * version, so editing the theme does not invalidate a file that reads it until that file is
       * touched. The names stay correct — they are recomputed whenever the reading file changes —
       * but a stale one can survive a keystroke in another window.
       */
      /**
       * Resolution asks the HOST, not the disk.
       *
       * `ts.sys` was the first version and it is wrong for the same reason the reader is: an editor's
       * project can hold a file the disk does not — a virtual one, a renamed one, one whose content
       * is only in a buffer. Measured, it resolved nothing at all in a project whose files were the
       * host's rather than the filesystem's, so every cross-module token read as unresolved.
       */
      const resolutionHost: ts.ModuleResolutionHost = {
        fileExists: (name) => host.fileExists?.(name) ?? tsModule.sys.fileExists(name),
        readFile: (name) => host.readFile?.(name) ?? tsModule.sys.readFile(name),
        directoryExists: (name) => host.directoryExists?.(name) ?? tsModule.sys.directoryExists(name),
        getCurrentDirectory: () => host.getCurrentDirectory(),
        getDirectories: (name) => host.getDirectories?.(name) ?? tsModule.sys.getDirectories(name),
        realpath: host.realpath?.bind(host),
      };

      /**
       * Said once per server, when the built package is behind its sources.
       *
       * Through `info.project.projectService.logger` rather than a console: a tsserver plugin has no
       * terminal, and the log is where somebody looks when the editor is not doing what the source
       * says it should. That is exactly the question this answers — see `warnIfStale`.
       */
      warnIfStale(__filename, (message) => {
        info.project?.projectService?.logger?.info?.(message);
      });

      /** The list the current `overlay` pass is filling — see the note on the cache's `read`. */
      let reading: { name: string; version: string }[] | undefined;

      /**
       * The project's own settings, transpiled with the `typescript` tsserver handed us.
       *
       * That is what makes a `.ts` config affordable in an editor at all — a plugin here is
       * CommonJS with no `ts-node`, and `require(".ts")` would tie the config to whatever Node the
       * editor embeds. See `config.ts`, where the three ways were measured.
       *
       * Asked per file rather than once per project. A review found this walking up from
       * `host.getCurrentDirectory()`, which in a monorepo opened at its root is one config for
       * files that have their own — so the editor squiggled against settings the build did not use.
       * The reader re-reads whenever the file's text changes, which keeps what the config is edited
       * for: an editor that had to be restarted to notice would be the same staleness the module
       * cache was fixed for. An editor session is a development session — see `environmentOf`.
       */
      const readProjectConfig = configReader(tsModule, environmentOf(false));
      const projectConfig = (fileName: string): Config => {
        try {
          return readProjectConfig(fileName);
        } catch {
          // A broken config must not take the editor's completions with it. `ramonda-css lint` is
          // where it is reported, with the file and the reason.
          return {};
        }
      };

      const readModuleFromEditor = (specifier: string, from: string): string | undefined => {
        const resolved = tsModule.resolveModuleName(specifier, from, host.getCompilationSettings(), resolutionHost);
        const name = resolved.resolvedModule?.resolvedFileName;
        if (name === undefined) return undefined;
        const snapshot = readSnapshot(name);
        if (snapshot === undefined) return undefined;
        reading?.push({ name, version: host.getScriptVersion(name) });
        return snapshot.getText(0, snapshot.getLength());
      };

      const overlay = (
        fileName: string,
        read: (name: string) => ts.IScriptSnapshot | undefined,
      ): VirtualFile | undefined => {
        if (!SOURCE.test(fileName)) return undefined;

        const version = host.getScriptVersion(fileName);
        const cached = cache.get(fileName);
        if (
          cached !== undefined &&
          cached.version === version &&
          cached.read.every((one) => host.getScriptVersion(one.name) === one.version)
        ) {
          return cached.file;
        }

        /** What this pass reads, filled in by the reader below and stored with the entry. */
        const readHere: { name: string; version: string }[] = [];
        // Armed for the whole pass — the virtual file resolves the same references the rules do.
        reading = readHere;

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
          text === undefined
            ? undefined
            : virtualFile(text, {
                properties: properties(info),
                tolerant: true,
                filename: fileName,
                read: readModuleFromEditor,
              });

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

        const css =
          text === undefined ? [] : cssFindings(text, fileName, readModuleFromEditor, projectConfig(fileName));
        const where = regions(text ?? "", fileName, readModuleFromEditor);
        reading = undefined;

        cache.set(fileName, {
          version,
          file,
          author,
          css,
          hints: text === undefined ? [] : siteFindings(text),
          where,
          read: readHere,
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

        /**
         * Nothing from TypeScript, in a value it has no union for — see {@link valueWords}.
         *
         * Only when it offered nothing at all: a closed grammar answers for itself and answers
         * better, and a property that admits a free identifier has no list here either.
         */
        {
          /**
           * A caret standing in a VALUE, decided from what we know rather than from what TypeScript
           * happened to answer.
           *
           * Measured, and it is why this is not "only when TypeScript said nothing": for an open
           * grammar it answered with the 551 PROPERTY names, which is the key position's list and
           * useless in a value. What decides is the property: a union is TypeScript's, everything
           * else is ours.
           */
          const where = cache.get(fileName)?.where ?? EMPTY_REGIONS;
          const value = where.values.find((one) => one.start < position && position <= one.end);
          /**
           * A caret at a hole's closing `}}` is still in the hole — you are typing at the end of the
           * expression. `isCss` reads the bound the other way, which is right for a classification:
           * the `}}` itself is ours to paint. Measured, without this the last character of every
           * expression offered CSS words instead of the file's own bindings.
           */
          const inHole = where.holes.some((one) => one.start <= position && position <= one.end);
          const words =
            value === undefined || inHole || !isCss(where, position) ? undefined : valueWords(value.property);
          if (words !== undefined) {
            return {
              isGlobalCompletion: false,
              isMemberCompletion: false,
              isNewIdentifierLocation: true,
              // `string` rather than a keyword: these are CSS values, and it is the icon a real CSS
              // language service gives them. Keywords sort above functions — see `entryFor`.
              entries: words.map(entryFor),
            };
          }
        }

        if (got === undefined) return undefined;

        /**
         * A CSS key is never quoted, and TypeScript sometimes offers one that is.
         *
         * A name that cannot be an identifier is a quoted key in the virtual file, and for a body
         * typed against a plain interface TypeScript answers with the quotes in the entry's NAME —
         * with no `insertText` beside it, so the name is what an editor writes. Measured: completing
         * inside `@@font-face( … )` offered `"font-family"`, and accepting it put those quotes into
         * the author's CSS, where they are a parse error. An ordinary block does not do this, which
         * is why it went unnoticed: its shape carries index signatures and TypeScript offers bare
         * names against it.
         *
         * Only inside the CSS, where a quoted key cannot be right. A hole is TypeScript and keeps
         * every quote it was given.
         */
        // `overlay` above has just filled the cache for this version, and `where` is the regions it
        // recorded — the same ones the classifications use.
        const where = cache.get(fileName)?.where ?? EMPTY_REGIONS;
        const css = isCss(where, position);

        /**
         * A replacement span, mapped home and REFUSED if it reaches past the caret's own line.
         *
         * **The second of two faults in the same field, and the worse one.** A span that is missing
         * costs a completion; a span that is too long DELETES CODE. Measured on the real file, `dis`
         * at the top of a block came back covering seventeen characters — `dis`, the newline, and the
         * `...` of the spread below — so accepting `display` would have left `display{CONTROL};` with
         * the spread's own line gone.
         *
         * The cause is the tolerant reading, which is right to do what it does: a declaration with
         * no colon becomes a quoted key, and the quote runs to the end of what it can take. What is
         * wrong is offering that as something to replace.
         *
         * A property name never contains a newline, so a span that does is not a name. Dropped, the
         * editor replaces the word under the caret — which is what it does when there is no span at
         * all, and is right in every case measured.
         */
        const authored = readSnapshot(fileName);
        const source = authored?.getText(0, authored.getLength()) ?? "";

        const replaces = (span: ts.TextSpan | undefined): ts.TextSpan | undefined => {
          const home = back(file, span);
          if (home === undefined) return undefined;
          /**
           * **No WHITESPACE in it**, which was a newline only, and a review found the wider rule.
           *
           * A completion replaces a token, and no token a block offers holds whitespace: not a
           * property name, not a keyword, not a unit. So a span that has any is a span standing for
           * more than the word under the caret — and this file's own answer to that is already
           * written down two paragraphs up.
           *
           * Measured, three shapes it stood for too much. A caret inside `@media (min-width: 40rem)`
           * came back with a span over the ENTIRE prelude and the space before the `{`, on all 551
           * entries, so accepting the first left `accent-color{ color: red; }`. A selector list the
           * same. And a value's span reached past the word to the `;`, so accepting `column` over
           * `col  ;` deleted the spaces the author had aligned with.
           *
           * Refusing costs nothing, which is what makes it the answer rather than a compromise: an
           * editor with no span replaces the word under the caret, and that is right in every case
           * measured — including the one still offered here, a property name being typed.
           */
          return /\s/.test(source.slice(home.start, home.start + home.length)) ? undefined : home;
        };

        return {
          ...got,
          /**
           * The span the editor REPLACES when a completion is accepted, mapped like every other.
           *
           * **It arrived through `...got` in the virtual file's coordinates**, and pointed at
           * unrelated characters in the author's — measured, `op` in an `@@if` group came back as a
           * span over `dd`, and `dis` at the top of a block as a span over `ip}>flip the tone<`. A
           * caret outside its own replacement span is something an editor is entitled to drop, and
           * VS Code did: no completions inside a group, while recovering at the top of a block. That
           * asymmetry is why it looked as though groups were special when nothing about the group was
           * involved.
           *
           * `undefined` rather than the unmapped span when it cannot be mapped: no span at all means
           * the editor uses the word under the caret, which is right, and a wrong one is what this
           * bug was.
           */
          optionalReplacementSpan: replaces(got.optionalReplacementSpan),
          entries: got.entries.map((entry) => ({
            ...entry,
            name: css ? unquoted(entry.name) : entry.name,
            insertText: css && entry.insertText === undefined ? unquoted(entry.name) : entry.insertText,
            replacementSpan: replaces(entry.replacementSpan),
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
        /**
         * What THIS language has to say, before TypeScript's answer about the virtual file.
         *
         * A selector, an at-rule condition and this language's own markers had nobody to answer for
         * them: measured, hovering `::after` gave `(property) "&::after": ({ content: string } | …)[]`
         * — a true sentence about an object literal, and useless. `@@if` and `...` gave nothing at
         * all. A property already answers well, so that path is untouched.
         */
        const said = spoken(cache.get(fileName)?.where ?? EMPTY_REGIONS, position);
        if (said !== undefined) return said;

        const got =
          service.getQuickInfoAtPosition(fileName, at) ?? quickInfoAt(service, fileName, file.declarationOf(position));
        if (got === undefined) return undefined;

        const read = asCss(got);
        /**
         * The span DROPPED when it cannot be mapped, the way every other span here is.
         *
         * It used to fall through to the virtual one — an offset in a file nobody wrote, handed to
         * an editor to highlight. A review found it by reading, and could find no caret that reaches
         * it; that is an argument for closing the path rather than for leaving it open, since the
         * cost of being right here is one `?? read.textSpan` not written.
         */
        const home = back(file, read.textSpan);
        return home === undefined ? undefined : { ...read, textSpan: home };
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
        return { ...got, spans: home(file, got.spans, span, cache.get(fileName)?.where ?? EMPTY_REGIONS) };
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
          return got === undefined ? undefined : elsewhere(overlayFor, got);
        };

      proxy.getDefinitionAtPosition = goingTo((name, at) => service.getDefinitionAtPosition(name, at));
      proxy.getTypeDefinitionAtPosition = goingTo((name, at) => service.getTypeDefinitionAtPosition(name, at));
      proxy.getImplementationAtPosition = goingTo((name, at) => service.getImplementationAtPosition(name, at));
      proxy.getReferencesAtPosition = goingTo((name, at) => service.getReferencesAtPosition(name, at));

      /**
       * An OFFSET turned into a line and a column — the one method nothing proxied, and the whole
       * reason go-to-definition landed in the wrong place. Reported three times.
       *
       * Two investigations checked whether the SPAN was mapped, and it was: measured through a real
       * `tsserver` against the user's own file, this plugin answered `virtual 10081 → author 9799`,
       * which is exactly the declaration. The span was never the problem.
       *
       * `tsserver` then converts that offset with `toFileSpan`, which calls
       * `languageService.toLineColumnOffset` rather than using the editor's own line map — and that
       * reads the program's source file, which is the VIRTUAL text. So a correct author offset came
       * back as a position in a file nobody wrote, wrong by however much the two texts differ above
       * it. Measured, and it matched the report to the character: offset 9799 is 307:7 in the
       * author's text and 302:55 in the virtual one, which is inside the comment above.
       *
       * `navtree` was the control that made this findable — it reports the same declaration
       * correctly, because it converts through the editor's `ScriptInfo` instead. One question, two
       * answers, and only one of them came through here.
       *
       * Every position this proxy hands out is in the AUTHOR's coordinates, so this counts lines in
       * the author's text. That is what the parsed copy beside the virtual one is for.
       */
      proxy.toLineColumnOffset = (fileName, position) => {
        overlay(fileName, readSnapshot);
        const author = cache.get(fileName)?.author;
        if (author === undefined) return service.toLineColumnOffset?.(fileName, position) ?? { line: 0, character: 0 };
        return author.getLineAndCharacterOfPosition(position);
      };

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
          definitions: got.definitions === undefined ? undefined : elsewhere(overlayFor, got.definitions),
        };
      };

      proxy.getDocumentHighlights = (fileName, position, filesToSearch) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getDocumentHighlights(fileName, position, filesToSearch);

        const at = file.virtualOf(position);
        if (at === undefined) return undefined;
        const got = service.getDocumentHighlights(fileName, at, filesToSearch);
        if (got === undefined) return undefined;

        // Each file's own overlay, not this one's — see `elsewhere` for the review that found it.
        return got.map((one) => {
          const its = overlayFor(one.fileName);
          if (its === undefined) return one;
          return {
            ...one,
            highlightSpans: one.highlightSpans.flatMap((span) => {
              const textSpan = back(its, span.textSpan);
              return textSpan === undefined ? [] : [{ ...span, textSpan }];
            }),
          };
        });
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

      /**
       * Any file's overlay, because an answer may name a file other than the one that was asked
       * about — and every file the program sees is virtual, not only this one. See `elsewhere`.
       */
      const overlayFor = (fileName: string) => overlay(fileName, readSnapshot);

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
       * RENAME, which had no proxy at all — and a rename WRITES at every span it returns.
       *
       * A review measured it on a file whose block reads a binding: the position went in unmapped,
       * so the wrong symbol was found, and the locations came back in virtual coordinates. Applied,
       * they produced `const tone = "redaccentt a = <div css=@@( … ` — the author's own source
       * destroyed, from one keystroke.
       *
       * Declined rather than mapped, for the reason written above the formatting edits: **this is the
       * one place refusing beats answering.** A rename that cannot be offered is a feature missing; a
       * rename that is offered and wrong is the file gone. `getRenameInfo` refuses too, so an editor
       * says so up front instead of failing at the end.
       *
       * Mapping it properly is possible — every location would need its own file's overlay, the way
       * `elsewhere` does it now — and it is deliberately not attempted here: the spans an editor
       * writes at are the last place to find out a mapping was one character out.
       */
      proxy.findRenameLocations = ((
        fileName: string,
        position: number,
        findInStrings: boolean,
        findInComments: boolean,
        preferences?: ts.UserPreferences | boolean,
      ) =>
        overlaid(fileName)
          ? undefined
          : (
              service.findRenameLocations as (
                fileName: string,
                position: number,
                findInStrings: boolean,
                findInComments: boolean,
                preferences?: ts.UserPreferences | boolean,
              ) => readonly ts.RenameLocation[] | undefined
            )(fileName, position, findInStrings, findInComments, preferences)) as typeof service.findRenameLocations;

      proxy.getRenameInfo = (fileName, position, preferences) =>
        overlaid(fileName)
          ? { canRename: false, localizedErrorMessage: RENAME_REFUSED }
          : service.getRenameInfo(fileName, position, preferences);

      /**
       * Expanding a selection, which is not an edit and becomes one the moment somebody types.
       *
       * Measured by the same review: a caret on a binding a block reads came back with a range over
       * `const t` — seven characters of unrelated code, selected. The next keystroke overwrites them.
       * An empty range is what an editor does nothing with.
       */
      proxy.getSmartSelectionRange = (fileName, position) =>
        overlaid(fileName) ? { textSpan: { start: 0, length: 0 } } : service.getSmartSelectionRange(fileName, position);

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
 * copy — so nothing is mapped.
 */
function ours(
  findings: readonly Finding[],
  file: ts.SourceFile | undefined,
  /**
   * An ERROR, and it was a warning until the build began refusing these.
   *
   * The old reasoning was that a page with `display: flexx` renders and the declaration is simply
   * dropped, so a warning was honest. That stopped being true the day `transform` started running
   * the checker: every finding these rules produce now refuses the build, and a yellow squiggle
   * under something that does not compile is the editor promising a page the build will not give.
   *
   * The severity is not a judgement about how bad the CSS is. It answers "will this build?", and
   * there is one answer. `1` is `Error`, `0` is `Warning`, `2` is `Suggestion` — which is what the
   * one about colours still gets, because nothing is wrong with that code and the build does not
   * care about it.
   */
  category = 1 as ts.DiagnosticCategory,
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
function cssFindings(text: string, fileName: string, read: Imported["read"], config: Config): Finding[] {
  const out: Finding[] = [];
  const references = namedSites(text, { filename: fileName, read });
  // What each registered property may HOLD, beside what it is called — see `syntaxesIn`.
  const syntaxes = syntaxesIn(text);
  for (const site of findBlocks(text)) {
    const read = readBlock(text, site.open, "", { tolerant: true, resolve: (name) => references.get(name) });
    // The text and the parse, because one of them has no name for a `//` — see `checkText`.
    out.push(
      ...checkText(text, site.open, read.end),
      ...checkBlock(read.block, { at: site.at, references, syntaxes, config }),
    );
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
function regions(text: string, fileName: string, readModule: Imported["read"]): Regions {
  const blocks: Span[] = [];
  const holes: Span[] = [];
  const values: ValueSpan[] = [];
  const preludes: PreludeSpan[] = [];
  // A resolved reference is not a hole, so it is not a region TypeScript owns — an editor must not
  // colour `{slide}` as an expression in a place the build writes a name into. Imports included:
  // a token from another module is resolved here exactly as the build resolves it.
  const references = namedSites(text, { filename: fileName, read: readModule });
  for (const site of findBlocks(text)) {
    const read = readBlock(text, site.open, "", { tolerant: true, resolve: (name) => references.get(name) });
    blocks.push({ start: site.open, end: read.end });
    holes.push(...read.holes);
    collect(read.block.items, values, preludes);
  }
  return { blocks, holes, values, preludes };
}

/** Every declaration's VALUE, with the property it belongs to — see `valueWords`. */
function collect(items: readonly BlockItem[], out: ValueSpan[], preludes?: PreludeSpan[]): void {
  for (const item of items) {
    if (item.kind === "rule") {
      // The prelude's own span, which a nested rule already carries for the checker's squiggles.
      if (item.at !== undefined && item.preludeEnd !== undefined) {
        preludes?.push({ start: item.at, end: item.preludeEnd, prelude: item.prelude });
      }
      collect(item.items, out, preludes);
      continue;
    }
    // A spread has no value and its own marker is what a reader hovers — see `spoken`.
    if (item.property.startsWith("...") && item.at !== undefined) {
      preludes?.push({ start: item.at, end: item.at + 3, prelude: "..." });
    }
    if (item.at === undefined || item.end === undefined) continue;
    /**
     * From the end of the property NAME rather than from `valueAt`, which skips to the first
     * character the author has typed. With nothing typed yet there is nothing to skip to — measured,
     * `overflow: ` put `valueAt` one PAST the caret, so the state you are in first was the one state
     * this could not answer.
     */
    out.push({ start: item.at + item.property.length, end: item.end, property: item.property });
  }
}

/**
 * The words a property accepts, for a caret standing in its value.
 *
 * **123 properties have a closed grammar and a real union, and TypeScript offers those itself** —
 * better than this could, with `!important` and `var()` beside each. The other 428 are
 * `string | number`, and measured, a caret there got NOTHING from us: typing `transform: n` offered
 * zero entries, so the editor fell back to its own word list and suggested `nav`, `noframes`,
 * `noscript` — HTML tag names, in a CSS value.
 *
 * The list is the one the CHECKER already reads. `KEYWORDS` holds the bare words each property's
 * grammar reaches, for exactly the properties the types do not cover, and `PROPERTY_NAMED` holds the
 * ones whose value is a property name. So the table that reports `display: flexx` is the table that
 * suggests `flex` — one answer asked twice, which is the arrangement this package keeps having to
 * repair when it is two.
 *
 * A property that admits a free identifier — `animation-name`, `font-family` — has no entry and gets
 * nothing, which is right: that name is the author's own and nothing can suggest it.
 */
function valueWords(property: string): readonly string[] | undefined {
  // A real union is TypeScript's to offer, and it offers `!important` and `var()` beside each word.
  if (UNION_TYPED.includes(property)) return undefined;

  const own = VALUE_WORDS[property];
  // A property whose value is a property NAME — `transition-property`, `will-change` — takes any of
  // them, which is what a real CSS language service offers there too.
  const named = PROPERTY_NAMED[property] === undefined ? [] : PROPERTIES;
  if (own === undefined && named.length === 0) return undefined;

  // Every property takes these, whatever else it takes.
  return [
    ...(own === undefined ? [] : own.split(" ").filter(Boolean)),
    ...named,
    "var()",
    "inherit",
    "initial",
    "unset",
    "revert",
    "revert-layer",
  ];
}

/**
 * One word as a completion entry.
 *
 * A function is written `translate()` in the table and offered under that name — which is what a
 * reader recognises — but INSERTED without its closing parenthesis, so the caret lands where the
 * arguments go and the editor closes the bracket itself.
 */
function entryFor(name: string): ts.CompletionEntry {
  const call = name.endsWith("()");
  return {
    name,
    kind: "string" as ts.ScriptElementKind,
    sortText: call ? "1" : "0",
    ...(call ? { insertText: name.slice(0, -1) } : {}),
  };
}

/** A quoted key as CSS spells it — see the note in `getCompletionsAtPosition`. */
function unquoted(name: string): string {
  return name.length > 1 && name.startsWith('"') && name.endsWith('"') ? name.slice(1, -1) : name;
}

/** Nothing at all, for a file whose regions are not cached. */
const EMPTY_REGIONS: Regions = { blocks: [], holes: [], values: [], preludes: [] };

/**
 * What THIS language says about a prelude, which nobody else can.
 *
 * **Reported by a user.** Hovering `::after` gave `(property) "&::after": ({ content: string } | …)[]`
 * — a true sentence about the object literal the virtual file builds, and useless to somebody asking
 * what `::after` does. `@@if` and `...` gave nothing at all. Measured, three shapes were wrong in two
 * ways and one was already right:
 *
 *     display, content    CSS grammar plus Initial/Inherited     already right, and untouched
 *     ::after, :hover     (property) "&::after": {               noise
 *     @media (…)          (property) "@media (…)": {             noise
 *     @@if, ...           nothing at all
 *
 * A property answers well because `asCss` reshapes what the generated types carry. This is the same
 * idea for everything else a block holds.
 *
 * The selector names, their groups and their MDN links are generated from `mdn-data`; the sentences
 * are written, and the generator refuses a sentence naming a selector CSS does not have. `@@if` and
 * `...` have no upstream — what they say is what this repository measured about them.
 */
const COMPOSITION: Readonly<Record<string, { signature: string; note: string }>> = {
  "@@if": {
    signature: "@@if ({ … })",
    note:
      "The declarations inside apply only while the condition holds.\n\n" +
      "Everything is one merge in the order it was written, so **later wins** — a group below a " +
      "declaration overrides it, and a group above it does not. That is the rule a reader of CSS " +
      "already has, and it is the thing a whole-block class could never express: the order of names " +
      "in a `class` attribute means nothing in CSS.\n\n" +
      "A group inside a group holds only when both conditions do.",
  },
  "...": {
    signature: "...{ … }",
    note:
      "Merges another block's declarations here, in this position.\n\n" +
      "It works across files, because what it merges is a value — importable, storable in an object, " +
      "or picked out of one, which is what makes a lookup exhaustive where an `@else` never could be.\n\n" +
      "**Later wins**, so what is spread above a declaration loses to it and what is spread below " +
      "overrides it.",
  },
};

/** `:has(…)` in a block is `:has()` upstream, and a bare `:hover` is itself. */
function selectorNamed(prelude: string): string | undefined {
  const trimmed = prelude.trim().replace(/^&/, "").trim();
  if (!trimmed.startsWith(":")) return undefined;

  const called = /^(:{1,2}[a-z-]+)\(/.exec(trimmed);
  if (called !== null) return `${called[1]}()`;
  return /^(:{1,2}[a-z-]+)$/.exec(trimmed)?.[1];
}

function spoken(where: Regions, at: number): ts.QuickInfo | undefined {
  const found = where.preludes.find((span) => span.start <= at && at <= span.end);
  if (found === undefined) return undefined;

  const span = { start: found.start, length: found.end - found.start };
  const say = (signature: string, note: string): ts.QuickInfo => ({
    // The kind an editor shows beside the signature. "" is "no icon", which is right for a
    // selector: it is not a variable, a property or a function.
    kind: "" as ts.ScriptElementKind,
    kindModifiers: "",
    textSpan: span,
    displayParts: [{ text: signature, kind: "text" }],
    documentation: note === "" ? [] : [{ text: note, kind: "text" }],
  });

  const trimmed = found.prelude.trim();
  const marker = trimmed.startsWith("@@if") ? "@@if" : trimmed === "..." ? "..." : undefined;
  const composition = marker === undefined ? undefined : COMPOSITION[marker];
  if (composition !== undefined) return say(composition.signature, composition.note);

  const name = selectorNamed(found.prelude);
  const known = name === undefined ? undefined : SELECTORS[name];
  if (name !== undefined && known !== undefined) {
    const lines = [known.group, known.note, known.url].filter((one) => one !== "");
    return say(name, lines.join("\n\n"));
  }

  /**
   * An at-rule shows its own text and its link, and no sentence.
   *
   * The difference from a selector is what the reader is asking: `@media (min-width: 40rem)` says
   * what it asks already, so a sentence would repeat the text. All 19 at-rules in `mdn-data` carry a
   * url, so this needs nothing written for it — which is also why an at-rule invented tomorrow shows
   * its own text rather than nothing.
   */
  const atRule = /^(@[a-z-]+)/.exec(trimmed)?.[1];
  const link = atRule === undefined ? undefined : AT_RULE_LINKS[atRule];
  if (link !== undefined) return say(trimmed, link);

  // A selector with no entry, or an at-rule nobody has heard of: its own text is the honest answer,
  // and it is better than a sentence about an object literal.
  return trimmed.startsWith("@") || trimmed.startsWith("&") || trimmed.startsWith(":") ? say(trimmed, "") : undefined;
}

/** A declaration's value, and the property it sets. */
interface ValueSpan {
  readonly start: number;
  readonly end: number;
  readonly property: string;
}

/** What one file's text is made of, as far as this plugin has to care. */
/** A nested rule's prelude, in the author's coordinates, with the text it holds. */
interface PreludeSpan {
  readonly start: number;
  readonly end: number;
  readonly prelude: string;
}

interface Regions {
  readonly blocks: readonly Span[];
  readonly holes: readonly Span[];
  readonly values: readonly ValueSpan[];
  /** Where each nested rule's prelude runs — a selector, an at-rule, or a condition. */
  readonly preludes: readonly PreludeSpan[];
}

/**
 * What an editor shows when a rename is declined.
 *
 * Named rather than a bare string, because it is the only sentence an author ever sees about this
 * and it has to say what to do instead — a refusal with no way forward reads as a broken editor.
 */
const RENAME_REFUSED =
  "A style block is not TypeScript, so renaming across one would write at positions in a file " +
  "nobody wrote. Rename from a file without a block, or edit the name by hand.";

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
 * Entries that may live in any file, each moved home out of ITS OWN file's coordinates.
 *
 * **Not just the file that was asked about**, and the comment here used to say otherwise: *"an entry
 * in another file already holds the position it should"*. A review measured that false. The host is
 * patched program-wide, so EVERY file the program sees is virtual — a definition in a second styled
 * file came back in that file's virtual coordinates, past the end of the author's text by the length
 * of the preamble. Reached by go-to-definition, go-to-type-definition, go-to-implementation,
 * find-references, definition-and-bound-span and document highlights.
 *
 * A file with no block has no overlay and is returned untouched, which is what the old branch was
 * really for.
 */
function elsewhere<T extends { fileName: string; textSpan: ts.TextSpan; contextSpan?: ts.TextSpan }>(
  overlayOf: (fileName: string) => VirtualFile | undefined,
  entries: readonly T[],
): T[] {
  return entries.flatMap((entry) => {
    const file = overlayOf(entry.fileName);
    if (file === undefined) return [entry];

    const textSpan = back(file, entry.textSpan);
    if (textSpan === undefined) return [];
    return [{ ...entry, textSpan, contextSpan: back(file, entry.contextSpan) }];
  });
}

/**
 * **`sameFileAs` used to live here, and it is gone because the question it answered is.**
 *
 * It compared two paths — an entry's file name against the file being asked about — so a definition
 * in ANOTHER file could be left alone while one in THIS file was mapped home. `!==` got that wrong
 * whenever the editor's spelling differed from TypeScript's normalised one, which the user reported
 * twice, and resolving both paths and asking the host about case was the fix.
 *
 * Then a review found the premise wrong: an entry in another file does NOT already hold the position
 * it should, because the host is patched program-wide and every file the program sees is virtual. So
 * `elsewhere` looks each entry's OWN file up in the overlay cache instead of comparing it to
 * anything — and a lookup that misses because a path is spelled differently simply builds that
 * file's overlay under the other spelling, which maps correctly either way.
 *
 * The three tests written for the spelling bug still pass, asking under a `.` segment and a doubled
 * separator. Kept as a note rather than as a function nothing calls: a dead helper with a story
 * attached is worse than the story on its own.
 */

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

/** The first line of a generated property's JSDoc: the name, an em dash, and the grammar. */
const GRAMMAR = /^`([a-z-]+)` — `([^`]*)`\n?/;

/**
 * A hover that reads as CSS rather than as the object literal the CSS is checked through.
 *
 * The type map is an object type, so TypeScript's own answer is
 * `(property) "padding-left"?: CssValue | undefined` — true, and the least useful true thing to put
 * on the first and largest line a reader sees. What someone hovering a CSS property wants is its
 * GRAMMAR, and the grammar is already here: the generated type carries it as the first line of its
 * JSDoc, written by `build-css-properties.mjs`.
 *
 * So this MOVES that line up rather than finding the answer a second time — the shape is pinned by a
 * test, because a format read in one place and written in another is where this package keeps
 * finding faults.
 *
 * A property the generator knows nothing about — a custom property — has no such line, and then
 * TypeScript's own answer stands, which is the right answer for a name only the author knows.
 */
function asCss(info: ts.QuickInfo): ts.QuickInfo {
  const documentation = info.documentation ?? [];
  const text = documentation.map((one) => one.text).join("");
  const found = GRAMMAR.exec(text);
  if (found === null) return info;

  const [whole, property, syntax] = found;
  return {
    ...info,
    displayParts: [
      { text: property, kind: "propertyName" },
      { text: ": ", kind: "punctuation" },
      { text: syntax, kind: "text" },
    ],
    // Without the line that just became the signature: moved, not copied.
    documentation: [{ text: text.slice(whole.length), kind: "text" }],
  };
}
