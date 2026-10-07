import type ts from "typescript";
import { NAMED_BLOCKS, type Finding } from "../compiler/rules";
import { fileMayHoldABlock, findBlocks } from "../compiler/scan";
import { typedFindingsFor } from "../compiler/typed";
import { type VirtualFile, virtualFile } from "../compiler/virtual";
import { type Config, configReader, environmentOf } from "../config/config";
import { propertiesFor } from "../config/generate";
import { warnIfStale } from "./stale";
import { EMPTY_REGIONS, regions, type Regions } from "./editor/regions";
import { cssFindings, ours, withoutRepeats } from "./editor/diagnostics";
import { back, bar, elsewhere, home, isCss, mapped, tree } from "./editor/spans";
import { caretIn, entryFor, selectorsFor, unquoted, valueWords } from "./editor/completion";
import { asCss, quickInfoAt, spoken } from "./editor/hover";

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

/**
 * The key the extension's shim sets when IT is the copy answering — see `cannotCompile`.
 *
 * A string rather than a symbol because it crosses a package boundary as plain data, and one long
 * enough that a key in somebody's `tsconfig.json` cannot collide with it by accident.
 */
export const NO_COMPILER = "@ramonda/css:no-compiler-in-the-project";

/** What `tsserver` hands the factory. Structural, so `typescript` stays a peer and not an import. */
export interface PluginCreateInfo {
  languageService: ts.LanguageService;
  languageServiceHost: ts.LanguageServiceHost;
  /**
   * The plugin's own entry from `tsconfig.json` — plus one key the extension's shim sets.
   *
   * See {@link NO_COMPILER}: it is how the copy bundled in the extension knows it is answering for
   * a project that has no `@ramonda/css` of its own, and so cannot build a block at all.
   */
  config?: { properties?: string; [NO_COMPILER]?: boolean };
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
          author: ts.SourceFile | undefined;
          /** Where the CSS, the holes and the values are — read once per version, asked on every paint. */
          where: Regions;
          /**
           * Every module this file READ a named site from, and the version each had.
           *
           * The file's own version is not enough once a block can resolve a token from elsewhere:
           * the answer is derived from the other module's TEXT, so editing the theme changes what
           * this file means without touching this file. Keyed on this file alone, the editor kept
           * saying a token existed after it had been deleted.
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
       * An editor's project can hold a file the disk does not — a virtual one, a renamed one, one
       * whose content is only in a buffer. Measured through `ts.sys`, a project whose files were
       * the host's resolved nothing, so every cross-module token read as unresolved.
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
       * editor embeds. See `config.ts`.
       *
       * Asked per file rather than once per project: walking up from `host.getCurrentDirectory()`
       * finds ONE config for a monorepo opened at its root, and files with their own would be
       * squiggled against settings the build does not use. The reader re-reads whenever the file's
       * text changes, so an edited config needs no editor restart. An editor session is a
       * development session — see `environmentOf`.
       */
      const readProjectConfig = configReader(tsModule, environmentOf(false));

      /**
       * Why a config this cannot read is REMEMBERED rather than only survived.
       *
       * Returning an empty config is right: a broken one must not take the editor's completions
       * with it, and measured, 828 property names are still offered. But it also takes every RULE,
       * in silence — measured across nine broken configs, a block breaking two of the project's own
       * settings was reported by none of them.
       *
       * The author wrote those settings. A green file is a claim, and with no config loaded the
       * tool cannot support it — so the reason is kept and said once, on a file that holds a block.
       */
      const configFailure = new Map<string, string>();
      const projectConfig = (fileName: string): Config => {
        try {
          const config = readProjectConfig(fileName);
          configFailure.delete(fileName);
          return config;
        } catch (error) {
          configFailure.set(fileName, error instanceof Error ? error.message : String(error));
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
        if (!fileMayHoldABlock(fileName)) return undefined;

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
                // The project's own map when it has generated one — the same answer the CLI gives,
                // so the editor and `ramonda-css check` cannot disagree about what a block accepts.
                properties: properties(info) ?? propertiesFor(fileName),
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
          where,
          read: readHere,
        });
        return file;
      };

      /**
       * The host is patched IN PLACE, and a second language service is not built.
       *
       * `Object.create(host)` over a `tsserver` project gives a language service with no program at
       * all — measured through a real `tsserver`, every completion came back `Cannot read
       * properties of undefined (reading 'getSourceFile')`. A project is not a plain object, and
       * what a service needs from one does not survive being shadowed.
       *
       * Patching the one method also leaves ONE program rather than two, and everything the proxy
       * does not override is already answering about the right file.
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
       * The two rules that read a style prop's TYPE, which the CLI check also runs.
       *
       * The language service has a program, so they run here too: a rule a person meets on a push
       * is one they meet after they have stopped thinking about the code; a squiggle is the same
       * rule while they are still in it.
       *
       * Asked for ONE file — the one being looked at — rather than for the program. Sound as well
       * as cheap: a slot's scope is the class or function declaring it, and a spread and the
       * declaration below it are one block, so neither rule ever reaches past the file it is given.
       *
       * The program's copy of an overlaid file is the VIRTUAL text, which is what these read; the
       * positions come back already mapped to the author's own. Measured at 0.15 ms for one call on
       * a real 605-line file, so there is no pre-filter; a file declaring no style prop leaves
       * after one walk.
       *
       * A reduced server never reaches here: `getSemanticDiagnostics` is refused outright in
       * `PartialSemantic`, and `Syntactic` has no program — both asserted in `plugin.test.ts`,
       * because a rule firing in the editor's syntax server would put a squiggle on every file
       * somebody opens.
       */
      const typedFor = (fileName: string): ts.Diagnostic[] => {
        const file = overlay(fileName, readSnapshot);
        const program = service.getProgram();
        const source = program?.getSourceFile(fileName);
        if (program === undefined || source === undefined) return [];

        const found = typedFindingsFor(
          program.getTypeChecker(),
          source,
          file === undefined ? undefined : { virtual: file },
          projectConfig(fileName),
        );
        return ours(found, cache.get(fileName)?.author);
      };

      /**
       * The compiler's `TS2344` where `allow-list-is-an-interface` already said it, and better.
       *
       * **The one place a typed rule stands IN FOR the compiler rather than beside it.** Every other
       * one answers a question TypeScript cannot ask, so both speaking at one character is two
       * faults rather than one said twice. Here the compiler reports the very same mistake, as *Type
       * 'CardStyle' is not assignable to type `{ [nested: …]: CssBlockShape[] }`* — an index
       * signature the author never wrote, and never the word `interface`.
       *
       * Both of this proxy's paths need it, and the FIRST one is the one that matters: a file
       * declaring a component's props usually holds no block at all, and that path hands the
       * compiler's diagnostics through untouched.
       *
       * By start position, because the rule is reported on the same node the compiler used. `check.ts`
       * drops the same pair for the build, from the same fact.
       */
      const withoutTheInterfaceRepeat = (typed: readonly ts.Diagnostic[], from: ts.Diagnostic[]): ts.Diagnostic[] => {
        const said = new Set(
          typed
            .filter((one) => String(one.messageText).startsWith("[allow-list-is-an-interface]"))
            .map((one) => one.start),
        );
        if (said.size === 0) return from;
        return from.filter((one) => !(one.code === 2344 && said.has(one.start)));
      };

      /**
       * Everything the service can do, with the virtual text underneath and positions mapped at the
       * boundary.
       *
       * The host is patched IN PLACE, so the service reads the virtual text for every question
       * anyone asks. An unmapped answer is an offset into text nobody wrote — and since the shift
       * is the same for the whole file, it is just as wrong ABOVE a block as inside one.
       *
       * So every answer carrying a position is mapped, and the ones that carry an EDIT are refused:
       * an edit computed against the virtual text would write scaffolding into the author's file.
       * What falls through is only what carries no position at all.
       */
      const proxy: ts.LanguageService = Object.create(service);

      /**
       * The word typed so far after a `@@` that has not been opened with a `(` — or nothing.
       *
       * Deliberately narrow. A `(` anywhere between the `@@` and the caret means the block is open
       * and the caret is in CSS, which every other branch already handles; a character that cannot
       * be part of a site's name means this is not a site being typed.
       */
      const openerAt = (text: string, position: number): string | undefined => {
        let index = position;
        while (index > 0 && /[a-zA-Z-]/.test(text[index - 1])) index--;
        if (index < 2 || text[index - 1] !== "@" || text[index - 2] !== "@") return undefined;
        // `@@@x` is not an opener, and `a@@x` is not one either — the scanner wants the pair alone.
        if (index > 2 && text[index - 3] === "@") return undefined;
        return text.slice(index, position);
      };

      /**
       * The three names a `@@name( … )` may carry — offered, and impossible to commit by accident.
       *
       * The list being right is not enough: the first entry is preselected, so typing `(` would
       * write `@@keyframes()` where the plain `@@( … )` was meant — one keystroke producing a block
       * nobody asked for.
       *
       * Two statements stop it, and both are true rather than tricks:
       *
       * - `isNewIdentifierLocation: true` — after `@@` the author may type something that is NOT in
       *   this list, namely the `(` of an ordinary block. That is what the flag means, and VS Code's
       *   TypeScript extension reads it to decide whether to add `(` to the commit characters. With
       *   it `false`, `(` commits the selection; with it `true`, `(` is just a `(`.
       * - `commitCharacters: []` per entry — said outright, for the editors that read the entry's
       *   own list rather than deriving one. Nothing should commit these but a deliberate Enter or
       *   Tab.
       */
      const namedSites = (typed: string, position: number): ts.WithMetadata<ts.CompletionInfo> => ({
        isGlobalCompletion: false,
        isMemberCompletion: false,
        isNewIdentifierLocation: true,
        entries: NAMED_BLOCKS.filter((one) => one.startsWith(typed.toLowerCase())).map((one, order) => ({
          name: one,
          kind: tsModule.ScriptElementKind.keyword,
          kindModifiers: "",
          sortText: String(order),
          commitCharacters: [],
          replacementSpan: { start: position - typed.length, length: typed.length },
        })),
      });

      proxy.getCompletionsAtPosition = (fileName, position, options, settings) => {
        /**
         * The caret right after `@@`, where nothing TypeScript knows can stand.
         *
         * `css={@@` holds no parens yet, so `findBlocks` sees no site and no overlay is built; the
         * question reaches TypeScript against the author's own text, where that caret is an
         * ordinary expression position. Measured, the answer was 1003 entries — every global, local
         * and keyword — and the preselected first one turned the next `(` into
         * `css={@@Component()}`.
         *
         * Answered BEFORE the overlay for the same reason: at this point there is no block to
         * overlay. Four things can follow `@@` — a `(`, or one of the three named sites this
         * compiles — so that is the list.
         */
        const snapshot = readSnapshot(fileName);
        const opener =
          snapshot === undefined ? undefined : openerAt(snapshot.getText(0, snapshot.getLength()), position);
        if (opener !== undefined) return namedSites(opener, position);

        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getCompletionsAtPosition(fileName, position, options, settings);

        const at = file.virtualOf(position);
        if (at === undefined) return undefined;

        let got = service.getCompletionsAtPosition(fileName, at, options, settings);

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
          /** The author's own text, for the two carets the parse has no run for — see below. */
          const written = snapshot?.getText(0, snapshot.getLength()) ?? "";
          const value = where.values.find((one) => one.start < position && position <= one.end);
          /**
           * A caret at a hole's closing `}}` is still in the hole — you are typing at the end of the
           * expression. `isCss` reads the bound the other way, which is right for a classification:
           * the `}}` itself is ours to paint. Measured, without this the last character of every
           * expression offered CSS words instead of the file's own bindings.
           */
          const inHole = where.holes.some((one) => one.start <= position && position <= one.end);
          // A `$` path is TypeScript's, for the same reason a hole is: it IS a TypeScript
          // expression, and the members of the project's variables are the only useful answer.
          const inPath = where.paths.some((one) => one.start <= position && position <= one.end);
          /**
           * A caret in EMPTY SPACE belongs to no parsed run — and to the WRONG one in a prelude.
           *
           * The regions above come from the parse, and a half-written line has not parsed into
           * anything yet. Measured, `position: ` and `&:` were both answered with the 828 property
           * names, while `position: stat` worked — the answer arrived only once you had typed
           * enough not to need it.
           *
           * Read from the TEXT, bounded by the block. What separates the two is the `&` at the head
           * of the run: a prelude in this language starts with one — `CssBlockShape` says so — and
           * `color:` and `&:` look identical from the caret backwards.
           *
           * Asked BEFORE the parse's own answer, not after: the parse reads `&:` as a declaration
           * whose property is `&`, so `where.values` would claim the caret. A run headed by `&` is
           * a prelude whatever the parse made of it.
           */
          const typing = !inHole && !inPath && isCss(where, position) ? caretIn(written, position, where) : undefined;

          if (typing?.kind === "prelude") {
            return {
              isGlobalCompletion: false,
              isMemberCompletion: false,
              isNewIdentifierLocation: true,
              entries: selectorsFor(typing.colons, typing.typed).map(entryFor),
            };
          }

          /**
           * An EMPTY value maps past the declaration, so TypeScript is asked where the value IS.
           *
           * Measured on `position: ` with the caret after the space: the caret maps to the key
           * position of the NEXT declaration in the virtual file, so the answer was the 828
           * property names; the character after it maps between the quotes of `position:""`, where
           * the value union is.
           *
           * Re-asked only where NOTHING is typed yet, which keeps this off every path that already
           * works. The region's own end is the value's extent, and it is what the property above is
           * read from, so this is the same fact used twice rather than a second guess at where the
           * value lives.
           */
          if (typing?.kind === "value" && typing.typed === "" && value !== undefined) {
            const inValue = file.virtualOf(value.end);
            if (inValue !== undefined && inValue !== at) {
              got = service.getCompletionsAtPosition(fileName, inValue, options, settings) ?? got;
            }
          }

          const property = value?.property ?? (typing?.kind === "value" ? typing.property : undefined);
          const words =
            property === undefined || inHole || inPath || !isCss(where, position)
              ? undefined
              : valueWords(property, projectConfig(fileName));
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
         * A span that is missing costs a completion; a span that is too long DELETES CODE.
         * Measured, `dis` at the top of a block came back covering seventeen characters — `dis`,
         * the newline, and the `...` of the spread below — so accepting `display` would have
         * deleted the spread's line.
         *
         * The cause is the tolerant reading, which is right to do what it does: a declaration with
         * no colon becomes a quoted key, and the quote runs to the end of what it can take. What is
         * wrong is offering that as something to replace.
         *
         * A property name never contains a newline, so a span that does is not a name. Dropped, the
         * editor replaces the word under the caret — which is what it does when there is no span at
         * all.
         */
        const authored = readSnapshot(fileName);
        const source = authored?.getText(0, authored.getLength()) ?? "";

        const replaces = (span: ts.TextSpan | undefined): ts.TextSpan | undefined => {
          const home = back(file, span);
          if (home === undefined) return undefined;
          /**
           * **No WHITESPACE in it.**
           *
           * A completion replaces a token, and no token a block offers holds whitespace: not a
           * property name, not a keyword, not a unit. So a span that has any stands for more than
           * the word under the caret. Measured, a caret inside `@media (min-width: 40rem)` came
           * back with a span over the ENTIRE prelude, so accepting the first entry left
           * `accent-color{ color: red; }`.
           *
           * Refusing costs nothing, which is what makes it the answer rather than a compromise: an
           * editor with no span replaces the word under the caret, and that is right in every case
           * measured — including a property name being typed.
           */
          return /\s/.test(source.slice(home.start, home.start + home.length)) ? undefined : home;
        };

        return {
          ...got,
          /**
           * The span the editor REPLACES when a completion is accepted, mapped like every other.
           *
           * It arrives through `...got` in the virtual file's coordinates — measured, `op` in a
           * `when` group came back as a span over `dd`. A caret outside its own replacement span is
           * something an editor is entitled to drop, and VS Code did: no completions inside a
           * group.
           *
           * `undefined` rather than the unmapped span when it cannot be mapped: no span at all
           * means the editor uses the word under the caret, which is right, and a wrong one is the
           * fault.
           */
          optionalReplacementSpan: replaces(got.optionalReplacementSpan),
          /**
           * This file's OWN declarations are taken out, wherever the caret is.
           *
           * The block helper and its neighbours are declared at the top of the virtual file, so they
           * are in scope everywhere in it and TypeScript offers them beside the author's bindings —
           * measured, 1005 entries where 1000 belong, `__block` first among them. `binding` picks a
           * name the author's source does not contain, so nothing of theirs is ever removed here.
           */
          entries: got.entries
            .filter((entry) => !file.bindings.includes(entry.name))
            .map((entry) => ({
              ...entry,
              name: css ? unquoted(entry.name) : entry.name,
              insertText: css && entry.insertText === undefined ? unquoted(entry.name) : entry.insertText,
              replacementSpan: replaces(entry.replacementSpan),
            })),
        };
      };

      /**
       * Where a virtual offset belongs in the author's file — with one allowance, for an INSERTION.
       *
       * An import goes ABOVE everything, and above everything in the virtual file is this package's
       * own preamble: the declarations that give a block its `@@`, its `$` and its holes. That text
       * has no home, so mapping it gives nothing and the import would be dropped.
       *
       * A zero-length insertion is different from every other span in one way that settles this: it
       * writes BEFORE a position rather than over a range, so the question is not *what character
       * is this* but *what does it come before*. So the scan walks forward to the first offset that
       * does have a home — the author's own first character, for an import.
       *
       * Only for an insertion. A span that REPLACES text and maps nowhere is text of ours, and
       * moving it somewhere plausible is how a file gets destroyed; that one is still dropped.
       */
      const homeFor = (file: VirtualFile, offset: number, inserting: boolean): number | undefined => {
        const home = file.homeOf(offset);
        if (home !== undefined || !inserting) return home;

        const length = file.code.length;
        for (let ahead = offset + 1; ahead <= length; ahead++) {
          const found = file.homeOf(ahead);
          if (found !== undefined) return found;
        }
        return undefined;
      };

      /**
       * The DETAILS of a completion — and accepting one that needs an import WRITES to the file.
       *
       * Unproxied, TypeScript gets the AUTHOR's position against the VIRTUAL text, and measured, it
       * returned `undefined`: the editor is handed an entry it can offer and cannot resolve, and an
       * accepted auto-import landed at the END of the file.
       *
       * The same shape as the rename fault below — an unmapped span an editor writes at — and it
       * differs in what to do about it. Refusing is right for a rename, which is a convenience. An
       * import is not: without it the completion list is offering something it cannot deliver. So
       * the spans are mapped HOME, and a code action holding one that maps nowhere is dropped whole
       * rather than applied in part.
       */
      proxy.getCompletionEntryDetails = (fileName, position, entryName, formatOptions, source, preferences, data) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) {
          return service.getCompletionEntryDetails(
            fileName,
            position,
            entryName,
            formatOptions,
            source,
            preferences,
            data,
          );
        }

        const at = file.virtualOf(position);
        if (at === undefined) return undefined;

        const got = service.getCompletionEntryDetails(
          fileName,
          at,
          entryName,
          formatOptions,
          source,
          preferences,
          data,
        );
        if (got?.codeActions === undefined) return got;

        /**
         * A change in this file is mapped; one in ANOTHER file is already in its own coordinates
         * and is left alone — unless that file carries a block too, in which case it is mapped by
         * its own overlay.
         */
        const homeward = (change: ts.FileTextChanges): ts.FileTextChanges | undefined => {
          const its = overlay(change.fileName, readSnapshot);
          if (its === undefined) return change;

          const textChanges: ts.TextChange[] = [];
          for (const one of change.textChanges) {
            const start = homeFor(its, one.span.start, one.span.length === 0);
            const end = one.span.length === 0 ? start : its.homeOf(one.span.start + one.span.length);
            if (start === undefined || end === undefined || end < start) return undefined;
            textChanges.push({ newText: one.newText, span: { start, length: end - start } });
          }
          return { ...change, textChanges };
        };

        const codeActions: ts.CodeAction[] = [];
        for (const action of got.codeActions) {
          const changes = action.changes.map(homeward);
          // All or nothing: half an import is worse than none, and this is a span an editor WRITES at.
          if (changes.some((one) => one === undefined)) continue;
          codeActions.push({ ...action, changes: changes as ts.FileTextChanges[] });
        }

        return { ...got, codeActions };
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
         * — a true sentence about an object literal, and useless. `when` and `...` gave nothing at
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
         * Falling through to the virtual one would hand an editor an offset in a file nobody wrote
         * to highlight. No caret is known to reach this path; closing it costs one `??
         * read.textSpan` not written.
         */
        const home = back(file, read.textSpan);
        return home === undefined ? undefined : { ...read, textSpan: home };
      };

      /**
       * One diagnostic saying nothing in this project can COMPILE a block, or nothing.
       *
       * The extension contributes this plugin to every project an editor opens, and hands over to
       * the project's own `@ramonda/css` wherever there is one. Where there is not, the editor
       * answers about a syntax the project cannot build: measured, `@@( colour: red; )` is reported
       * as `unknown-property` in the editor and refused by esbuild with *Expected identifier but
       * found "@"*. An editor that only said the first is promising a page the build will not give.
       *
       * **The shape is TypeScript's own.** Writing JSX in a project with no `jsx` option is not met
       * with silence and not with a broken parse — it is parsed, it is checked, and one more
       * diagnostic names what the project is missing:
       *
       *     TS17004: Cannot use JSX unless the '--jsx' flag is provided.
       *     TS7026:  JSX element implicitly has type 'any' because no interface
       *              'JSX.IntrinsicElements' exists.
       *
       * So this sits beside the CSS reports rather than replacing them: they are still true about
       * the CSS, and this is what makes them a preview instead of a promise.
       *
       * Only the SHIM can know it, and it already does — it resolves the project's own plugin
       * before deciding which copy answers. A project that names this plugin in its own
       * `tsconfig.json` has the package by definition and never sees it.
       */
      const cannotCompile = (fileName: string): ts.Diagnostic[] => {
        if (info.config?.[NO_COMPILER] !== true) return [];

        const text = readSnapshot(fileName);
        const source = text?.getText(0, text.getLength()) ?? "";
        const [site] = findBlocks(source);
        if (site === undefined) return [];

        return [
          {
            file: cache.get(fileName)?.author,
            start: site.start,
            length: site.open - site.start + 1,
            category: tsModule.DiagnosticCategory.Error,
            code: 0,
            messageText:
              "[no-compiler] nothing in this project compiles a style block, so a build will refuse " +
              "this file.\n        What you see here comes from the Ramonda CSS extension's own copy " +
              "of the compiler.\n\n" +
              "        Install `@ramonda/css` and add its plugin to your build — see " +
              "https://ramonda.dev/style-blocks/setup",
          },
        ];
      };

      /**
       * One diagnostic saying the project's config did not load, or nothing.
       *
       * Only reached for a file that HOLDS a block — `getSemanticDiagnostics` has already returned
       * the inner service's answer for anything else — because a file with no CSS in it is not
       * affected by the config and marking it would be noise on every file in the project.
       *
       * On the first block's opener, so it sits where the missing rules would have spoken. A
       * zero-width span is a squiggle nobody can see; see `Finding.length` in `rules.ts`.
       */
      const brokenConfig = (fileName: string): ts.Diagnostic[] => {
        const why = configFailure.get(fileName);
        if (why === undefined) return [];

        const text = readSnapshot(fileName);
        const source = text?.getText(0, text.getLength()) ?? "";
        const [site] = findBlocks(source);
        if (site === undefined) return [];

        return [
          {
            file: cache.get(fileName)?.author,
            start: site.start,
            length: site.open - site.start + 1,
            category: tsModule.DiagnosticCategory.Error,
            // Zero, for the reason `ours` gives: this is not TypeScript's, and the id is in the text.
            code: 0,
            messageText:
              `[config-not-read] ${why}\n\n` +
              "        Until it reads, none of this project's rules are running — this block is not " +
              "being\n        checked against them, and a build will refuse before it gets here.",
          },
        ];
      };

      proxy.getSemanticDiagnostics = (fileName) => {
        const file = overlay(fileName, readSnapshot);
        /**
         * **A file with no block still gets the TYPED rules**, because a component may declare a
         * style prop and hold no block of its own — a wrapper that only hands its prop on is the
         * ordinary shape. Without this, the build reported one and the editor said nothing, and an
         * editor quieter than the build is the thing this package cannot afford. `typedFor` leaves
         * after one walk when a file declares no style prop, which is every file in every unrelated
         * project an editor opens.
         */
        if (file === undefined) {
          const typed = typedFor(fileName);
          return [...typed, ...withoutTheInterfaceRepeat(typed, service.getSemanticDiagnostics(fileName))];
        }

        /**
         * The CSS rules beside the type errors, and this is where the hole rule earns its place: the
         * build refuses a hole written where a custom property cannot go, and here it is a squiggle
         * under the character, while it is being typed.
         */
        const ours = cssFor(fileName);
        const typed = typedFor(fileName);
        return [
          ...cannotCompile(fileName),
          ...brokenConfig(fileName),
          ...ours,
          ...typed,
          ...withoutTheInterfaceRepeat(
            typed,
            withoutRepeats(
              ours,
              mapped(file, service.getSemanticDiagnostics(fileName)),
              readSnapshot(fileName)?.getText(0, readSnapshot(fileName)?.getLength() ?? 0) ?? "",
            ),
          ),
        ];
      };

      /**
       * The colours an editor paints OVER the grammar's.
       *
       * An editor paints twice: a TextMate grammar first, then semantic tokens from the language
       * service on top. Those tokens are spans, the service is reading the virtual file, and the
       * preamble alone is hundreds of characters — so applied to the author's text at face value,
       * every colour in the file lands on the wrong characters. Measured on a four-line file, the
       * spans sliced out `\nconst `, ` = <div css=` and `before, a, af`.
       *
       * It is worst ABOVE a block: the shift is the same for the whole file, so code with nothing
       * to do with a block is painted just as wrongly.
       *
       * The whole virtual file is asked about rather than the author's range, because a range
       * cannot be converted — one author range is several virtual ones, with scaffolding in
       * between. The answer is mapped back and then cut to what was asked for.
       */
      proxy.getEncodedSemanticClassifications = (fileName, span, format) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getEncodedSemanticClassifications(fileName, span, format);

        const got = service.getEncodedSemanticClassifications(fileName, { start: 0, length: file.code.length }, format);
        return { ...got, spans: home(file, got.spans, span, cache.get(fileName)?.where ?? EMPTY_REGIONS) };
      };

      /**
       * THE DIMMING, which is a diagnostic nobody thinks of as one.
       *
       * VS Code fades unused code out, and what it fades is this list — a third one beside the
       * semantic and syntactic diagnostics. Unproxied, it comes straight off the VIRTUAL file:
       * measured, `TS6133` for `__vars` landed on `olor: ` in the author's text, and hovering a
       * `<div>` said `'__cond' is declared but its value is never read`.
       *
       * `mapped` is the whole fix: a diagnostic about the author's own text keeps its place, and
       * one about the preamble maps to nothing and is dropped — so an unused name they really did
       * write is still faded, which is the half a blanket `return []` would break.
       */
      proxy.getSuggestionDiagnostics = (fileName) => {
        const file = overlay(fileName, readSnapshot);
        return file === undefined
          ? service.getSuggestionDiagnostics(fileName)
          : mapped(file, service.getSuggestionDiagnostics(fileName));
      };

      /**
       * The TODO list, which is a position too. Measured unproxied, a `// TODO` the author wrote
       * came back at offset 838 in a file barely a hundred characters long.
       *
       * The same `back` the diagnostics use, so a comment in the author's text keeps its place and
       * one the preamble happens to contain is dropped.
       */
      proxy.getTodoComments = (fileName, descriptors) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getTodoComments(fileName, descriptors);

        const out: ts.TodoComment[] = [];
        for (const one of service.getTodoComments(fileName, descriptors)) {
          const span = back(file, { start: one.position, length: one.message.length });
          if (span !== undefined) out.push({ ...one, position: span.start });
        }
        return out;
      };

      /** Folding, and the outline that feeds the breadcrumbs — both are spans. */
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
       * An OFFSET turned into a line and a column — and go-to-definition depends on it.
       *
       * `tsserver` converts a definition's offset with `toFileSpan`, which calls
       * `languageService.toLineColumnOffset` rather than using the editor's own line map — and that
       * reads the program's source file, which is the VIRTUAL text. So a correctly mapped author
       * offset came back as a position in a file nobody wrote: measured, offset 9799 is 307:7 in
       * the author's text and 302:55 in the virtual one.
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

        // Each file's own overlay, not this one's — see `elsewhere`.
        return got.map((one) => {
          const its = overlayFor(one.fileName);
          if (its === undefined) return one;
          return {
            ...one,
            highlightSpans: one.highlightSpans.flatMap((span) => {
              const textSpan = back(its, span.textSpan);
              /**
               * **The CONTEXT span too.**
               *
               * A highlight carries the name and the statement an editor shows around it. Measured
               * unmapped, on a file of 103 characters the context came back at 948 — inside the
               * preamble of the virtual copy, so an editor reading that range reads past the end of
               * the file it is showing.
               */
              const contextSpan = span.contextSpan === undefined ? undefined : back(its, span.contextSpan);
              return textSpan === undefined ? [] : [{ ...span, textSpan, contextSpan }];
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
       * RENAME — and a rename WRITES at every span it returns.
       *
       * Unmapped, the position goes in at the wrong place, so the wrong symbol is found, and the
       * locations come back in virtual coordinates. Measured on a file whose block reads a binding,
       * applying them produced `const tone = "redaccentt a = <div css=@@( … ` — the author's own
       * source destroyed, from one keystroke.
       *
       * Declined rather than mapped, for the reason written above the formatting edits: **this is
       * the one place refusing beats answering.** A rename that cannot be offered is a feature
       * missing; a rename that is offered and wrong is the file gone. `getRenameInfo` refuses too,
       * so an editor says so up front instead of failing at the end.
       *
       * Mapping it properly is possible — every location would need its own file's overlay, the way
       * `elsewhere` does it — and it is deliberately not attempted: the spans an editor writes at
       * are the last place to find out a mapping was one character out.
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
       * Measured: a caret on a binding a block reads came back with a range over `const t` — seven
       * characters of unrelated code, selected. The next keystroke overwrites them. An empty range
       * is what an editor does nothing with.
       */
      proxy.getSmartSelectionRange = (fileName, position) =>
        overlaid(fileName) ? { textSpan: { start: 0, length: 0 } } : service.getSmartSelectionRange(fileName, position);

      /**
       * **THE REST OF THE SURFACE.**
       *
       * `Object.create(service)` means everything not overridden falls through, and the host is
       * patched IN PLACE — so a fall-through answers about the virtual text. Three of these were
       * measured writing into the author's file.
       *
       * **`getEditsForFileRename` is the worst of them, and it fires from renaming an unrelated
       * file.** TypeScript computes import-path edits for every file in the project when one is
       * renamed; measured on a 103-character file, it answered with an edit at offset 565, inside
       * the preamble this plugin wrote.
       *
       * `toggleLineComment` is the everyday one: Cmd+/ on a block's second line commented line ONE —
       * the line holding that offset in the virtual text is the preamble's first, which starts at
       * offset 0 in both texts. And `getDocCommentTemplateAtPosition` offered a JSDoc built from this
       * plugin's own `__block(declarations: …)` declaration.
       *
       * All of them are refused rather than mapped, for the reason written above the formatting
       * edits: **an edit that cannot be offered is a feature missing; an edit that is offered and
       * wrong is the file gone.** The surface is asserted in `plugin.test.ts`, so a method
       * TypeScript adds later is a failing test rather than something met in an editor.
       */
      proxy.getEditsForFileRename = (oldPath, newPath, formatOptions, preferences) => {
        const its = service.getEditsForFileRename(oldPath, newPath, formatOptions, preferences);
        // Every file's own overlay: the ones this does not overlay keep their edits, which are theirs.
        return its.filter((one) => overlayFor(one.fileName) === undefined);
      };

      proxy.getPasteEdits = (args, formatOptions) =>
        overlaid(args.targetFile)
          ? { edits: [], fixId: undefined as never }
          : service.getPasteEdits(args, formatOptions);

      proxy.toggleLineComment = (fileName, range) =>
        overlaid(fileName) ? [] : service.toggleLineComment(fileName, range);
      proxy.toggleMultilineComment = (fileName, range) =>
        overlaid(fileName) ? [] : service.toggleMultilineComment(fileName, range);
      proxy.commentSelection = (fileName, range) =>
        overlaid(fileName) ? [] : service.commentSelection(fileName, range);
      proxy.uncommentSelection = (fileName, range) =>
        overlaid(fileName) ? [] : service.uncommentSelection(fileName, range);

      proxy.getDocCommentTemplateAtPosition = (fileName, position, options, formatOptions) =>
        overlaid(fileName)
          ? undefined
          : service.getDocCommentTemplateAtPosition(fileName, position, options, formatOptions);

      proxy.getJsxClosingTagAtPosition = (fileName, position) =>
        overlaid(fileName) ? undefined : service.getJsxClosingTagAtPosition(fileName, position);

      proxy.getLinkedEditingRangeAtPosition = (fileName, position) =>
        overlaid(fileName) ? undefined : service.getLinkedEditingRangeAtPosition(fileName, position);

      /**
       * The answers that carry a position and no edit — mapped where a span comes back, refused where
       * one does not.
       *
       * `findReferences` is the one a person meets: it is what the "Find All References" PANEL calls,
       * and `getReferencesAtPosition` — proxied above — is the other API for the same question.
       * Measured on a 106-character file, it answered with a reference at offset **583**.
       *
       * The rest hand back a span into a file: a brace's match, the statement a breakpoint goes on,
       * the comment around a caret. None of them writes, so a wrong one is a misdrawn box rather than
       * a lost file — but a breakpoint on the wrong line is a debugging session spent on the wrong
       * question, and none of them costs anything to map.
       */
      proxy.findReferences = (fileName, position) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.findReferences(fileName, position);

        const at = file.virtualOf(position);
        if (at === undefined) return undefined;
        const got = service.findReferences(fileName, at);
        if (got === undefined) return undefined;

        return got.flatMap((one) => {
          const its = overlayFor(one.definition.fileName);
          if (its === undefined) return [{ ...one, references: elsewhere(overlayFor, one.references) }];

          const textSpan = back(its, one.definition.textSpan);
          if (textSpan === undefined) return [];
          const contextSpan = one.definition.contextSpan && back(its, one.definition.contextSpan);
          return [
            {
              definition: { ...one.definition, textSpan, ...(contextSpan === undefined ? {} : { contextSpan }) },
              references: elsewhere(overlayFor, one.references),
            },
          ];
        });
      };

      /** A span in, a span out — every one of these is the same shape. */
      const spanning =
        (run: (fileName: string, at: number) => ts.TextSpan | undefined) =>
        (fileName: string, position: number): ts.TextSpan | undefined => {
          const file = overlay(fileName, readSnapshot);
          if (file === undefined) return run(fileName, position);

          const at = file.virtualOf(position);
          return at === undefined ? undefined : back(file, run(fileName, at));
        };

      proxy.getBreakpointStatementAtPosition = spanning((name, at) =>
        service.getBreakpointStatementAtPosition(name, at),
      );
      proxy.getSpanOfEnclosingComment = (fileName, position, onlyMultiLine) =>
        spanning((name, at) => service.getSpanOfEnclosingComment(name, at, onlyMultiLine))(fileName, position);

      proxy.getNameOrDottedNameSpan = (fileName, start, end) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getNameOrDottedNameSpan(fileName, start, end);

        const from = file.virtualOf(start);
        const to = file.virtualOf(end);
        if (from === undefined || to === undefined) return undefined;
        return back(file, service.getNameOrDottedNameSpan(fileName, from, to));
      };

      proxy.getBraceMatchingAtPosition = (fileName, position) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getBraceMatchingAtPosition(fileName, position);

        const at = file.virtualOf(position);
        if (at === undefined) return [];
        return service.getBraceMatchingAtPosition(fileName, at).flatMap((span) => {
          const home = back(file, span);
          return home === undefined ? [] : [home];
        });
      };

      /**
       * The rest carry a position and answer with something no mapping puts right — a hint drawn
       * between two characters, a call hierarchy of items in several files, a classification of the
       * scaffolding's own tokens. Refused, which draws nothing rather than drawing it in the wrong
       * place.
       *
       * `getEncodedSemanticClassifications` is proxied properly above, and it is the one an editor
       * uses for semantic colour; these are its older siblings.
       */
      proxy.provideInlayHints = (fileName, span, preferences) =>
        overlaid(fileName) ? [] : service.provideInlayHints(fileName, span, preferences);

      proxy.prepareCallHierarchy = (fileName, position) =>
        overlaid(fileName) ? undefined : service.prepareCallHierarchy(fileName, position);
      proxy.provideCallHierarchyIncomingCalls = (fileName, position) =>
        overlaid(fileName) ? [] : service.provideCallHierarchyIncomingCalls(fileName, position);
      proxy.provideCallHierarchyOutgoingCalls = (fileName, position) =>
        overlaid(fileName) ? [] : service.provideCallHierarchyOutgoingCalls(fileName, position);

      proxy.getSyntacticClassifications = ((fileName: string, span: ts.TextSpan, format?: unknown) =>
        overlaid(fileName)
          ? []
          : (service.getSyntacticClassifications as (a: string, b: ts.TextSpan, c?: unknown) => unknown)(
              fileName,
              span,
              format,
            )) as typeof service.getSyntacticClassifications;

      proxy.getSemanticClassifications = ((fileName: string, span: ts.TextSpan, format?: unknown) =>
        overlaid(fileName)
          ? []
          : (service.getSemanticClassifications as (a: string, b: ts.TextSpan, c?: unknown) => unknown)(
              fileName,
              span,
              format,
            )) as typeof service.getSemanticClassifications;

      proxy.getEncodedSyntacticClassifications = (fileName, span) =>
        overlaid(fileName)
          ? { spans: [], endOfLineState: 0 as ts.EndOfLineState }
          : service.getEncodedSyntacticClassifications(fileName, span);

      /**
       * A position in and a number or a boolean out — nothing to map on the way back, and the
       * position going in still has to be the author's.
       */
      proxy.getIndentationAtPosition = (fileName, position, options) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.getIndentationAtPosition(fileName, position, options);

        const at = file.virtualOf(position);
        return at === undefined ? 0 : service.getIndentationAtPosition(fileName, at, options);
      };

      proxy.isValidBraceCompletionAtPosition = (fileName, position, openingBrace) => {
        const file = overlay(fileName, readSnapshot);
        if (file === undefined) return service.isValidBraceCompletionAtPosition(fileName, position, openingBrace);

        const at = file.virtualOf(position);
        return at === undefined ? false : service.isValidBraceCompletionAtPosition(fileName, at, openingBrace);
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

/** Where the block shape lives, so a project can point it at a fixture or at a wrapper's own. */
function properties(info: PluginCreateInfo): string | undefined {
  return info.config?.properties;
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
