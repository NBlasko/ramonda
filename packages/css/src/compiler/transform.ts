import MagicString from "magic-string";
import { segments } from "./flatten";
import type { AtomicDeclaration } from "./flatten";
import { SHORTHANDS } from "./keywords.generated";
import { keyIn } from "../key";
import { classNameFor, markerFor, nameForSite, nameFor, substitute, variableNameFor, writableProperty } from "./names";
import type { Config } from "../config";
import { type Imported, importedSites, namedSites, syntaxesIn } from "./references";
import { normalise } from "./normalise";
import { type VariableRead, type Variables, variablesIn } from "./variables";
import { type Span, readBlock, tryReadBlock } from "./read";
import { refuse } from "./errors";
import { ignoredIn, isIgnored } from "./ignore";
import { checkBlock, checkNamedSite, checkSite, checkTemplates, checkText } from "./rules";
import { type BlockSite, afterShebang, findBlocks, mayHoldABlock } from "./scan";

/**
 * An author's file in, valid TSX out, plus the rules it now owes a stylesheet.
 *
 * This is the same transform six things run: the build, `tsc` through a virtual file, the editor,
 * `ramonda-check`, the test runner and the documentation gate. There is exactly one of it on
 * purpose — a second reading of the syntax is a second answer to what a file means.
 *
 * ## The rule that decides the whole shape of the output
 *
 * **Only the CSS between the expressions is replaced. No expression's bytes move.** Overwriting a
 * block in one span is the obvious thing and it costs the mapping: measured, a hole then reported
 * the block's opening line instead of its own — line 8 for something written on line 13. Writing
 * the gaps out one at a time costs nothing and is what makes the source map exact.
 *
 * ## The map's resolution, which is not the obvious setting
 *
 * Generating the map is about half the transform's whole cost, so the three settings were measured
 * rather than picked. All three get every LINE right, including inside an expression spanning four
 * of them — magic-string emits a mapping at each line start whatever it is told. The difference is
 * columns, on lines this never touched:
 *
 *     hires: true        every column exact      1393 chars of mappings   22.0 µs/file
 *     hires: "boundary"  every column exact       723 chars              22.2 µs/file
 *     hires: false       every column -> 0         97 chars              16.4 µs/file
 *
 * `false` is the cheap one and it collapses `one(two(), three())` to the start of its line — for the
 * whole file, not only near a block, because this map sits above the bundler's. `boundary` costs the
 * same as `true` and carries half the mappings, so it is what is used.
 */

export interface TransformOptions {
  /** For the source map and for what a refusal says. */
  readonly filename?: string;
  /** Where `block` is imported from. A wrapper for another JSX library points this at itself. */
  readonly runtime?: string;
  /**
   * How to read a module this file imports a named site from — see {@link Imported}.
   *
   * Injected rather than `fs`, and not only to keep the compiler free of Node: the editor must read
   * its own unsaved buffer, and a name here is a hash of the DECLARATION it finds there. Two readers
   * two different texts would generate two different names for one token, and the editor would then
   * report a fault the build does not have.
   *
   * Omitted, a cross-module reference stays a hole and `hole-as-a-variable-name` reports it — which
   * is what every caller that has not opted in gets, and it is the safe direction.
   */
  readonly read?: Imported["read"];
  /** The project's own settings, from `ramonda.css.ts`. The bundler plugin reads it once. */
  readonly config?: Config;
}

/** One rule the stylesheet now owes. Assembly (dedupe, `@layer`, the collision assertion) is track E. */

export interface EmittedBlock {
  /** `r-` plus 16 hex — see CONTRACT.md. */
  readonly className: string;
  /**
   * The at-rule this is, when it is one — `keyframes`, `font-face`, `property`.
   *
   * `undefined` for an ordinary block, which is one element's rule and becomes `.r-… { … }`. A named
   * one becomes `@keyframes r-… { … }` and is referenced by NAME rather than applied to an element,
   * which is why it carries no properties.
   */
  readonly at?: string;
  /** The rule's body, custom properties substituted, nested rules still nested. */
  readonly css: string;
  /** The custom property names this rule reads, in hole order. */
  readonly properties: readonly string[];
  /**
   * The property this rule sets, when it sets exactly one — an ATOMIC rule.
   *
   * `undefined` for a whole-block rule, which sets several and is ordered by nothing. What this
   * decides is emission ORDER: a shorthand has to be written before its own longhands, or a longhand
   * the author put first loses to it. See {@link Sheet}.
   */
  readonly property?: string;
  /** The shorthand a split produced this from, which puts it in a weaker layer. See `layerPathFor`. */
  readonly from?: string;
  /** Whether it is `!important`, which MIRRORS its layer — CSS reads layer order backwards for those. */
  readonly important?: boolean;
  /**
   * What is appended to the class in the selector — `:hover`, ` .title`, `::before`.
   *
   * A whole-block rule keeps its nested rules INSIDE it and CSS resolves the nesting. An atomic one
   * cannot: each declaration is its own rule with its own class, so the selector belongs on that
   * class. `undefined` and `""` both mean the class alone.
   */
  readonly selector?: string;
  /**
   * The conditional at-rules this sits inside, outermost first — `@media (min-width: 40rem)`.
   *
   * Written around the rule rather than around the block, for the same reason as {@link selector}.
   * They are also what puts a rule LAST in the sheet: measured, a `@media` rule beats a base rule
   * for the same property only if it is emitted after it.
   */
  readonly conditions?: readonly string[];
}

/**
 * Declared here rather than re-exported, so the published types do not carry the map generator's.
 * The fields are the source map specification's own.
 */
export interface SourceMap {
  readonly version: number;
  readonly file?: string;
  readonly sources: readonly (string | null)[];
  readonly sourcesContent?: readonly (string | null)[];
  readonly names: readonly string[];
  readonly mappings: string;
}

export interface TransformResult {
  readonly code: string;
  readonly map: SourceMap;
  readonly blocks: readonly EmittedBlock[];
  /**
   * What this file does with custom properties, for the check that only the WHOLE build can make.
   *
   * A `var(--x)` is answerable when every name the build sets is known, and no single file knows
   * that — the name may be set by a block three components away. So the transform collects and the
   * `Sheet` decides, at the moment it has everything. See `Sheet.verifyVariables`.
   */
  readonly variables: Variables;
}

/**
 * `undefined` when there is nothing to do, which is the answer almost every time.
 *
 * A codebase that uses none of this pays one substring search per file: measured on this repository
 * before any of it existed, 1,268 files and 10.61 MB in **1.33 ms**. A plugin returning `undefined`
 * here hands the file on untouched, with no map to compose and no string to rebuild.
 */
export function transform(source: string, options: TransformOptions = {}): TransformResult | undefined {
  if (!mayHoldABlock(source)) return undefined;

  const filename = options.filename ?? "unknown.tsx";

  /**
   * A block inside a `${ … }` compiles to nothing and would reach the bundler as `@@(` — a syntax
   * error naming neither the block nor the line. Refused here, where the position is still ours, and
   * **before the early return**: a file whose only block is in a template finds no site at all, so
   * asking after that return is asking where nothing is left to ask.
   */
  const [inATemplate] = checkTemplates(source);
  if (inATemplate !== undefined) refuse(inATemplate.message, source, inATemplate.at, filename);

  const sites = findBlocks(source);
  if (sites.length === 0) return undefined;

  /**
   * What each named site in this file is called, so a reference to one is written in rather than set
   * on an element — see {@link namedSites} for why that is not an optimisation but the only thing
   * that works.
   */
  const from = importedSites(source, { filename, read: options.read });
  const references = namedSites(source, { filename, read: options.read });
  // What each registered property may HOLD, beside what it is called — see `syntaxesIn`.
  const syntaxes = syntaxesIn(source, { filename, read: options.read });
  const resolve = (expression: string): string | undefined => references.get(expression);

  /** What every block in this file sets and reads, in one list each — see {@link TransformResult}. */
  const variablesSet: string[] = [];
  const variablesRead: VariableRead[] = [];

  /**
   * What the author took responsibility for, so the BUILD honours it too.
   *
   * A directive that silenced the checker and left the build failing would be no escape at all — the
   * person would meet the same finding one command later, with nothing to do about it. Its own
   * refusals ride the same list: `ignoredIn` reports a directive with no reason, and that finding
   * cannot itself be ignored, because it is on the directive's own line rather than the line below.
   */
  const { ignored, findings: aboutDirectives } = ignoredIn(source);
  const [wrongDirective] = aboutDirectives;
  if (wrongDirective !== undefined) refuse(wrongDirective.message, source, wrongDirective.at, filename);

  const magic = new MagicString(source);
  const block = binding(source, "_merge");
  /** What a `match` becomes at run time — see `pick` in `merge.ts`. */
  const lookup = binding(source, "_pick");
  /** The two registrations a module makes — see the prologue below. */
  const clearing = binding(source, "_clears");
  const conditions = binding(source, "_under");
  const naming = binding(source, "_named");
  /** Whether any block used one, so a file with no lookup imports nothing it does not call. */
  let picked = false;
  const prefix = identifierPrefix(source);

  /** Class -> the atomic rule, so a declaration written a hundred times is one rule. */
  const atoms = new Map<string, EmittedBlock>();
  /**
   * What this FILE registers with the runtime, collected across every block in it.
   *
   * A block is a class string and two things do not fit in one: what a shorthand clears, and the
   * conditions a key sits under. Each is registered once per module for what that module's own
   * blocks need — see `shorthands` and `conditionsOf` in `merge.ts`.
   */
  const shorthandsUsed = new Map<string, readonly string[]>();
  const conditionsUsed = new Map<string, string>();
  const namesUsed = new Map<string, string>();
  /** Each ordinary site's map, split at the holes, so the author's expressions never move. */
  const written: { site: BlockSite; pieces: string[]; holes: readonly Span[]; end: number }[] = [];
  /** The named sites, which produce a rule and a name rather than a value the runtime builds. */
  const named = new Map<string, EmittedBlock>();
  const emittedNamed: EmittedBlock[] = [];
  /** The end of the block read last, so a `name=@@(` found INSIDE one is not read as another. */
  let consumed = 0;

  /**
   * The rules of every named site this file IMPORTED — see {@link importedSites}.
   *
   * A reference resolves to text, so after this transform the imported binding is referenced by
   * nothing the emitted code holds. The import goes unused, the bundler drops the module, and the
   * `@property` it declared never reaches the stylesheet. **Measured through a real Vite build: the
   * reading classes were right and the registration was simply absent.**
   *
   * So the file that READS a token emits that token's rule. Twice costs nothing — the name is a hash
   * of the declaring module's own text, so every reader emits the same rule under the same name and
   * the sheet keeps one. The theme module need not be in the JavaScript graph at all.
   */
  for (const text of from.texts) {
    for (const site of findBlocks(text)) {
      if (site.at === undefined) continue;
      // Its own file is where a fault in it is reported — see `tryReadBlock`. A refusal from here
      // would carry THIS file's name and an offset into the imported one.
      const read = tryReadBlock(text, site.open);
      if (read === undefined) continue;
      const canonical = normalise(read.block);
      const className = nameForSite(site.at, site.name, canonical);
      // A `@@property` SETS the name it registers: the registration carries an `initial-value`, so a
      // `var()` reading it always resolves. Recorded here because the generated name is only known now.
      if (site.at === "property") variablesSet.push(className);
      if (named.has(className)) continue;
      // Its own file is where a fault in it is reported; this is only carrying the rule across.
      const emitted: EmittedBlock = { className, css: substitute(canonical, className), properties: [], at: site.at };
      named.set(className, emitted);
      emittedNamed.push(emitted);
    }
  }

  for (const site of sites) {
    if (site.start < consumed) {
      refuse(
        "a block cannot contain another block — a hole holds a value, and a nested `@@( … )` is not one.",
        source,
        site.start,
        filename,
      );
    }

    /**
     * A named site is a VALUE — a name the stylesheet uses — so it cannot be an attribute.
     *
     * The attribute spelling is rewritten from the attribute's NAME, because the braces are ours to
     * add; a named site compiles to a string instead, and the same rewrite put that string where the
     * name was. Measured: `<div css=@@keyframes( … )>` came out as `<div "r-…">x</div>`, a syntax
     * error the build emitted without a word.
     */
    if (site.at !== undefined && site.wrap) {
      refuse(
        `\`@@${site.at}( … )\` names something the whole stylesheet uses, so it cannot be an ` +
          `attribute on one element. Write it as \`const ${site.at === "font-face" ? "brand" : "name"} = ` +
          `@@${site.at}( … );\` and refer to it from a block with a hole.`,
        source,
        site.start,
        filename,
      );
    }

    const read = readBlock(source, site.open, filename, { resolve });
    consumed = read.end + 1;

    /**
     * Everything the checker knows, applied to the artefact.
     *
     * **This seam was missing and it is the fault behind the `@property` report.** `checkBlock` was
     * called by `ramonda-check` and by the editor; `transform` — the only path a BUILD takes —
     * called neither, so a fault was reported to the two people most likely to notice it and
     * compiled into the output anyway. Measured, a `@property` written inside a block shipped out of
     * a real Vite build as `@property --x { .r-hash { syntax: "<color>" } }`, a registration
     * Chromium 151 drops entirely while leaving the name accepting any junk.
     *
     * It is here rather than in each bundler's plugin because there are two of those and the next
     * one would forget. The FIRST finding is what the refusal names: findings arrive sorted by
     * position, the build stops at one anyway, and `ramonda-check` is what lists them all.
     */
    // A site whose NAME is not one this compiles gets that one finding and no more — there is no
    /**
     * **The SITE first, then the block.** A bare JSX attribute is no longer a spelling this compiles,
     * and a block written that way must be refused before anything reads its CSS — reporting a
     * property inside a block whose spelling is wrong sends a reader after the wrong thing.
     *
     * This seam is also where the rule moved from. It was `checkSite` in `plugin.ts` alone, drawn as
     * a suggestion the build never saw, which was right while the spelling was supported.
     */
    // shape to check its body against, so anything else said about it is a guess. See `checkedSource`.
    /**
     * **A site finding goes through `rules` too**, and it did not.
     *
     * The refusal below prints the id in front of the sentence so a reader knows which key to write
     * in `ramonda.css.ts` — and for these two the key did nothing. Measured: a project that switched
     * `block-as-a-jsx-attribute` off still failed its build, while a `ramonda-css-ignore` above the
     * line let the same file through and compiled it correctly. Two escape hatches the documentation
     * offers as equals, one of them shut.
     *
     * `checkBlock` has done this since it took a config; these come from `checkSite` and
     * `checkNamedSite`, which never saw one. The rule that must NOT be silenced — a block inside a
     * `${ … }`, which would reach the bundler as `@@(` — is refused above this and names no key, so
     * it is untouched by the filter and stays that way.
     */
    const silenced = options.config?.rules;
    const siteFindings = [...checkSite(source, site), ...checkNamedSite(site)].filter(
      (one) => silenced?.[one.rule] !== "off",
    );
    const [finding] = (
      siteFindings.length > 0
        ? siteFindings
        : [
            ...checkText(source, site.open, read.end),
            ...checkBlock(read.block, { at: site.at, references, syntaxes, config: options.config }),
          ]
    )
      .filter((one) => !isIgnored(source, ignored, one))
      .sort((a, b) => a.at - b.at);
    /**
     * **The rule's id, then its sentence** — the way `ramonda-css` already prints one.
     *
     * The build printed the sentence alone, so a person stopped by it had no way to learn which key
     * to write in `ramonda.css.ts`, while the same fault through the checker named it. The id is
     * what somebody wants at exactly that moment, and `rules` takes it verbatim.
     *
     * A refusal the PARSER makes carries no rule and is untouched: there is no key to switch off,
     * and naming one would send a reader after something that is not there.
     */
    if (finding !== undefined) refuse(`${finding.rule}: ${finding.message}`, source, finding.at, filename);

    /**
     * Every custom property this block sets and reads, kept for the whole-build check.
     *
     * A named site is skipped: `@@keyframes` and `@@font-face` set nothing on an element, and a
     * `@@property` REGISTERS a name rather than reading one — that name is recorded below, where the
     * class it generates is known.
     */
    if (site.at === undefined) {
      const found = variablesIn(read.block);
      variablesSet.push(...found.set);
      variablesRead.push(...found.read);
    }

    // Normalised ONCE. It was called twice — for the name and again for the rule — and normalisation
    // walks the whole block, so that was a second full pass per block for a string already in hand.
    const canonical = normalise(read.block);
    // What a named site is called is `nameForSite`'s to decide, and it is the only thing that decides
    // it — the references map and the syntax map ask the same function. See its own note.
    const className = site.at === undefined ? classNameFor(canonical) : nameForSite(site.at, site.name, canonical);
    // A `@@property` SETS the name it registers: the registration carries an `initial-value`, so a
    // `var()` reading it always resolves. Recorded here because the generated name is only known now.
    if (site.at === "property") variablesSet.push(className);
    const properties = read.holes.map((_hole, index) => variableNameFor(className, index));

    /**
     * A named site is a NAME, not a value to build, so it needs no runtime and no descriptor: the
     * site becomes a string literal and the rule goes to the sheet under the same hashed name.
     */
    if (site.at !== undefined) {
      const emitted: EmittedBlock = { className, css: substitute(canonical, className), properties, at: site.at };
      if (!named.has(className)) {
        named.set(className, emitted);
        emittedNamed.push(emitted);
      }
      magic.overwrite(site.start, read.end + 1, JSON.stringify(className));
      continue;
    }

    /**
     * An ordinary block is a MAP: one entry per declaration, from what it sets to the class that
     * sets it. See CONTRACT.md §1b, and `merge` for what a call site then does with two of them.
     */
    /**
     * The map's text, cut wherever one of the author's expressions goes.
     *
     * A hole in a value, a spread's operand and a condition are all TypeScript the transform must
     * not touch — and all three appear in source order, because `segments` walks depth-first and a
     * guard is written above what it guards. So one rule serves all three: end the piece, let the
     * expression follow where it was written, begin the next piece after it.
     */
    const pieces: string[] = [];
    let piece = "";
    const expression = (): void => {
      pieces.push(piece);
      piece = "";
    };

    /**
     * A group inside a group opens a NESTED merge rather than repeating the outer guard.
     *
     * **The obvious shape is `a && b && { … }` and this transform cannot produce it.** An expression
     * is left exactly where the author wrote it — that is what makes the source map exact — so a
     * guard can be emitted once, and a nested segment would need its outer guard a second time.
     * Measured before this existed, the outer guard was simply dropped:
     *
     *     if ({off}) { cursor: none; if ({roomy}) { color: yellow } }
     *     -> _merge({…}, off && {cursor}, roomy && {color})
     *
     * and `color` landed whenever `roomy` was on, whatever `off` was.
     *
     * Nesting the merge says the same thing with each guard written once:
     *
     *     _merge({…}, off && _merge({cursor}, roomy && {color}))
     *
     * and the holes still appear in source order, which is the rule the whole emission rests on. It
     * is only correct because merging is associative and later still wins — the property `compose`
     * is built around.
     */
    const all = [...segments(read.block, { split: true })];

    /**
     * Whether a guard needs a merge of its own, or may simply join the conjunction.
     *
     * A guard that holds ONE thing is a conjunction — `a && b && { … }` — and that is both shorter
     * and the shape this transform emitted before nesting was fixed. A guard that holds more than
     * one needs a merge, because its own guard can be written only once and the second thing under
     * it would otherwise lose it.
     */
    const holdsMoreThanOne = (guards: readonly number[], upto: number): boolean =>
      all.filter(
        (other) =>
          other.guards.length >= upto && guards.slice(0, upto).every((one, index) => other.guards[index] === one),
      ).length > 1;

    /** The guard levels that opened a merge, innermost last — so leaving one closes the right ones. */
    const open: number[] = [];
    let previous: readonly number[] = [];

    let first = true;
    for (const segment of all) {
      /** How many guards this segment shares with the one before it. */
      let shared = 0;
      while (
        shared < previous.length &&
        shared < segment.guards.length &&
        previous[shared] === segment.guards[shared]
      ) {
        shared++;
      }
      // Leaving a group closes its merge; the comma then separates siblings at the right level.
      while (open.length > 0 && open[open.length - 1] >= shared) {
        piece += ")";
        open.pop();
      }
      previous = segment.guards;

      if (!first) piece += ",";
      first = false;

      // Each guard this segment does not already sit under, from the deepest one still open.
      const from = open.length === 0 ? 0 : open[open.length - 1] + 1;
      for (let index = from; index < segment.guards.length; index++) {
        expression();
        piece += " && ";
        if (holdsMoreThanOne(segment.guards, index + 1)) {
          piece += `${block}(`;
          open.push(index);
        }
      }

      if (segment.kind === "spread") {
        /**
         * A spread merges a whole block, and a block's map carries the context each of its
         * declarations was written in. Inside a selector or a conditional at-rule it would have to
         * re-scope every key it holds — `background` becoming `:hover|background` — which a merge
         * cannot do at runtime.
         *
         * **Measured before this refusal existed: it compiled and the selector silently vanished.**
         * `&:hover { ...{{base}}; }` came out as `_merge(base)`, so a block meant for hover applied
         * always. A GUARD is fine and is allowed: `if` changes no key, it only decides whether the
         * whole map lands.
         */
        // Reported by `spread-out-of-place`, which the refusal above already stopped the build on.
        // Asserted rather than repeated, so the two answers cannot drift into being two answers.
        if (segment.selector !== "" || segment.conditions.length > 0) {
          throw new Error(`a spread inside \`${segment.selector || segment.conditions.join(" ")}\` reached emission`);
        }
        expression();
        continue;
      }

      /**
       * Every arm of one `match` is its own rule and its own class, and they share a key — so a run
       * of them is ONE call that chooses between their classes rather than a class. `register` below
       * still runs for each, because each has a rule to emit.
       */
      const armsFrom = (from: number): AtomicDeclaration[] => {
        const first = segment.items[from];
        if (first.arm === undefined) return [];
        const group = [first];
        while (from + group.length < segment.items.length) {
          const next = segment.items[from + group.length];
          if (next.arm === undefined || next.key !== first.key) break;
          group.push(next);
        }
        return group;
      };

      /** The atom a declaration becomes, registered once however many times it is written. */
      const register = (declaration: AtomicDeclaration): string => {
        // Readable where one can be written, the hash where it cannot — see `nameFor`, which is
        // where the whole identity is hashed when it comes to that.
        const own = nameFor(declaration);
        if (!atoms.has(own)) {
          atoms.set(own, {
            className: own,
            css: substitute(declaration.canonical, own),
            properties: declaration.holes.map((_hole, index) => variableNameFor(own, index)),
            property: declaration.property,
            from: declaration.from,
            important: declaration.important,
            selector: declaration.selector,
            conditions: declaration.conditions,
          });
        }
        return own;
      };

      /**
       * What this declaration clears, when it is a shorthand — collected for the whole FILE and
       * registered once, rather than written into every block that uses one.
       *
       * Keyed by the PROPERTY as a key writes it, because the context composes itself at run time —
       * see `shorthands` in `merge.ts`. Only the shorthands this file actually writes, which is what
       * keeps a table of ninety-eight out of every page: 23 KB raw, 3.7 KB gzipped, against a whole
       * runtime smaller than that.
       */
      const clears = (declaration: AtomicDeclaration): void => {
        const covered = SHORTHANDS[declaration.property];
        const written = writableProperty(declaration.property);
        if (covered === undefined || written === undefined) return;

        const longhands = covered.map(writableProperty).filter((one): one is string => one !== undefined);
        if (longhands.length === covered.length) shorthandsUsed.set(written, longhands);
      };

      /**
       * The CONDITIONS a key sits under, for the development-only order warning — see `slotOf`.
       *
       * A key carries its context as the author's own text or as a hash, and a hash cannot be read
       * back. So the text is registered beside it, for the keys the warning can say anything about:
       * a condition and no selector, because a selector adds specificity and settles the question
       * on its own.
       */
      const conditionsUnder = (declaration: AtomicDeclaration, className: string): void => {
        if (declaration.conditions.length === 0 || declaration.selector !== "") return;
        conditionsUsed.set(keyIn(className), declaration.conditions.join("|"));
      };

      /**
       * And what the author CALLED the property, because a key writes `pl` where they wrote
       * `padding-left` — a message naming the form sends somebody looking for a string in no file.
       *
       * **Only for a declaration under a CONDITION**, which is the same guard the conditions have
       * and for the same reason: nothing else can be the subject of a warning. Two keys with no
       * context at all are the same key, and a property compared against itself at one slot is
       * silent. Every longhand such a shorthand names goes in with it, since the warning names those
       * without ever having seen a class for one — including one written in another module, which is
       * how a conditional `padding` here warns about a plain `padding-left` there.
       */
      const namesFor = (declaration: AtomicDeclaration): void => {
        if (declaration.conditions.length === 0 || declaration.selector !== "") return;

        const written = writableProperty(declaration.property);
        if (written !== undefined) namesUsed.set(written, declaration.property);
        for (const one of SHORTHANDS[declaration.property] ?? []) {
          const form = writableProperty(one);
          if (form !== undefined) namesUsed.set(form, one);
        }
      };

      /**
       * A SEGMENT is ONE merge argument, whatever it holds.
       *
       * Its declarations are a class string; a `match` among them is a call that chooses a class at
       * run time, so it cannot be inside that string. Written out flat they would be two arguments
       * and the guard in front — `on && …` — would reach only the first. So a segment holding more
       * than one part wraps them in a merge of its own, which says the same thing because merging is
       * associative and later still wins.
       *
       * The parts are counted in a first pass because the wrapper has to be emitted before the
       * first one, and that pass is where each declaration's rule is registered.
       */
      type Part = { kind: "classes"; written: string[] } | { kind: "match"; group: AtomicDeclaration[] };
      const parts: Part[] = [];
      /** The families whose marker this segment already carries — see `markerFor`. */
      const marked = new Set<string>();

      for (let index = 0; index < segment.items.length; index++) {
        const group = armsFrom(index);
        if (group.length > 0) {
          for (const one of group) {
            conditionsUnder(one, register(one));
            namesFor(one);
          }
          clears(group[0]);
          parts.push({ kind: "match", group });
          index += group.length - 1;
          continue;
        }

        const declaration = segment.items[index];
        if (declaration.holes.length > 0) {
          throw new Error(
            `[@ramonda/css] internal: a declaration in ${filename} reached emission carrying a runtime ` +
              `value, which \`hole-not-allowed\` refuses before this. Please report it.`,
          );
        }
        const own = register(declaration);
        conditionsUnder(declaration, own);
        namesFor(declaration);
        clears(declaration);

        // A split's pieces go in after their family's marker, which has to come FIRST: the merge
        // reads left to right, and the marker clears what the pieces are about to set.
        const marker =
          declaration.from === undefined
            ? undefined
            : markerFor(declaration.from, declaration.selector, declaration.conditions);
        const written = marker === undefined || marked.has(marker) ? [own] : [marker, own];
        if (marker !== undefined) marked.add(marker);

        const last = parts[parts.length - 1];
        if (last !== undefined && last.kind === "classes") last.written.push(...written);
        else parts.push({ kind: "classes", written });
      }

      /** An empty group sets nothing, and an empty string is what a merge skips. */
      if (parts.length === 0) piece += '""';

      /**
       * Only under a GUARD. `on && …` reaches one argument, so a guarded segment holding two has to
       * put them in a merge of its own. An unguarded one needs nothing: its parts are arguments of
       * the merge the site already opens, and a merge of a merge says the same thing twice.
       */
      const wrapped = parts.length > 1 && segment.guards.length > 0;
      if (wrapped) piece += `${block}(`;
      for (let index = 0; index < parts.length; index++) {
        if (index > 0) piece += ",";
        const part = parts[index];
        if (part.kind === "classes") {
          piece += JSON.stringify(part.written.join(" "));
          continue;
        }

        const fallback = part.group.find((one) => one.arm?.otherwise === true);
        picked = true;
        piece += `${lookup}(`;
        expression();
        piece += ",{";
        for (const one of part.group) {
          if (one.arm?.otherwise === true) continue;
          piece += `${JSON.stringify(one.arm?.is ?? "")}:${JSON.stringify(nameFor(one))},`;
        }
        piece += "}";
        if (fallback !== undefined) piece += `,${JSON.stringify(nameFor(fallback))}`;
        piece += ")";
      }
      if (wrapped) piece += ")";
    }
    // Every nested merge still open at the end of the block.
    while (open.length > 0) {
      piece += ")";
      open.pop();
    }
    pieces.push(piece);

    written.push({ site, pieces, holes: read.holes, end: read.end });
  }

  /**
   * A block with no holes is hoisted; one with holes is built where it is written.
   *
   * **Measured, and it is why this is not simply a call at every site.** 71% of the blocks written to
   * be read in this repository carry no hole, and for those the merged value cannot change — so
   * merging at the site would allocate per element per render for a constant. `merge` of one map is
   * 0.86 µs against 0.001 µs for reading a hoisted value; on 800 elements that is 0.69 ms of nothing.
   *
   * A block WITH holes cannot be hoisted: its values are the render's. It pays one allocation, which
   * is what a per-element value costs and what the previous design paid too.
   *
   * Deduped by the map's text, so the same block written twice is one constant.
   */
  const hoisted = new Map<string, string>();
  for (const one of written) {
    if (one.holes.length > 0) continue;
    const map = one.pieces[0];
    if (!hoisted.has(map)) hoisted.set(map, `${prefix}${hoisted.size}`);
  }

  for (const one of written) {
    const wrap = one.site.wrap;
    const head = wrap ? `${one.site.name}={` : "";
    const tail = wrap ? "}" : "";

    /**
     * The invariant the whole rewrite below rests on: one piece of surrounding text per hole, plus
     * a tail. It was never stated, and breaking it was silent.
     *
     * An `if` group with nothing in it recorded a hole and produced no segment, so every piece slid
     * one place left: one block emitted its map twice, another put a guard where a value belonged,
     * and `if ({variant}) { }` alone compiled to `_merge(variant)` — which parses, runs, and ships
     * two class names made out of the letters of a string. `flatten.ts` no longer produces that
     * shape; this is the belt, because a mismatch here means an author's expression is about to be
     * written somewhere it was not written, and that must never be something to discover at runtime.
     */
    if (one.pieces.length !== one.holes.length + 1) {
      throw new Error(
        `[@ramonda/css] internal: a block in ${filename} produced ${one.pieces.length} piece(s) for ` +
          `${one.holes.length} hole(s), and every expression after the mismatch would be emitted in ` +
          `the wrong place. This is a bug in the compiler, not in the block. Please report it.`,
      );
    }

    if (one.holes.length === 0) {
      magic.overwrite(one.site.start, one.end + 1, `${head}${hoisted.get(one.pieces[0])}${tail}`);
      continue;
    }

    magic.overwrite(one.site.start, one.holes[0].start, `${head}${block}(${one.pieces[0]}`);
    for (let index = 0; index < one.holes.length - 1; index++) {
      magic.overwrite(one.holes[index].end, one.holes[index + 1].start, one.pieces[index + 1]);
    }
    magic.overwrite(one.holes[one.holes.length - 1].end, one.end + 1, `${one.pieces[one.pieces.length - 1]})${tail}`);
  }

  // A file of nothing but named sites needs no runtime at all: a name is a string, not a value to
  // build, so the import would be one nobody uses.
  const prologue =
    written.length === 0
      ? ""
      : // `JSON.stringify`, because this is a PATH. The option exists for a wrapper around another
        // JSX library and the bundler plugins point it at an absolute one — which on Windows is
        // `C:\Users\…`, and interpolating that emitted `from "C:\Users\x\dist\index.js"`: a
        // syntax error, since `\x` starts a hex escape. Measured. A quote ended the string early.
        `import { mergeClassNames as ${block}${picked ? `, pick as ${lookup}` : ""}` +
        `${shorthandsUsed.size > 0 ? `, shorthands as ${clearing}` : ""}` +
        `${conditionsUsed.size > 0 ? `, conditionsOf as ${conditions}` : ""}` +
        `${namesUsed.size > 0 ? `, namesOf as ${naming}` : ""}` +
        ` } from ${JSON.stringify(options.runtime ?? "@ramonda/css")};\n` +
        /**
         * What a class string cannot carry, registered by the module that needs it.
         *
         * **The shorthands run always**, because clearing is what a merge DOES: a `padding` written
         * below a caller's `padding-left` has to remove it, the way CSS's own cascade does.
         *
         * **The conditions run only in development**, because the only thing that reads them is the
         * order warning, which is development-only. A bundler that replaces `process.env.NODE_ENV`
         * drops the call and the object with it — measured through a real Vite production build for
         * the warning's own `said` set, which disappears the same way.
         */
        `${shorthandsUsed.size > 0 ? `${clearing}(${JSON.stringify(Object.fromEntries(shorthandsUsed))});\n` : ""}` +
        `${
          conditionsUsed.size > 0 || namesUsed.size > 0
            ? `if (process.env.NODE_ENV !== "production") { ${
                conditionsUsed.size > 0 ? `${conditions}(${JSON.stringify(Object.fromEntries(conditionsUsed))}); ` : ""
              }${namesUsed.size > 0 ? `${naming}(${JSON.stringify(Object.fromEntries(namesUsed))}); ` : ""}}\n`
            : ""
        }` +
        `${[...hoisted].map(([map, id]) => `const ${id} = ${block}(${map});`).join("\n")}\n\n`;

  const top = afterDirectives(source);
  if (top === 0) magic.prepend(prologue);
  else magic.appendRight(top, prologue);

  return {
    code: magic.toString(),
    map: magic.generateMap({ source: filename, includeContent: true, hires: "boundary" }) as unknown as SourceMap,
    blocks: [...emittedNamed, ...atoms.values()],
    variables: { set: variablesSet, read: variablesRead },
  };
}

/**
 * The site rewritten, in as many pieces as there are gaps.
 *
 * A block with no holes is not a call: the descriptor IS the value, so the site reads `css={_s0}`
 * and the program allocates once however many elements carry the class. See CONTRACT.md.
 *
 * **What is replaced depends on how the block was written.** A bare JSX attribute needs braces the
 * author did not write, so the NAME is replaced too and the site becomes `css={_s0}`. The two
 * expression spellings — `css={@@( … )}` and `const panel = @@( … )` — need nothing but the value, so
 * only the block itself is replaced and everything to its left is the author's own text. Wrapping
 * one of those would turn a value into an object literal.
 */

/**
 * A name for the descriptors that the file does not already use.
 *
 * `_s0` is what CONTRACT.md shows and what a person reading the output expects, so it is the base
 * and it only grows when it has to — a file that already says `_s` gets `_s_`, and so on. Checking
 * the whole source for the PREFIX rather than for each name is what makes one check enough for all
 * of them.
 */
function identifierPrefix(source: string): string {
  let prefix = "_s";
  while (source.includes(prefix)) prefix += "_";
  return prefix;
}

function binding(source: string, base: string): string {
  let name = base;
  while (source.includes(name)) name = `_${name}`;
  return name;
}

/**
 * Where the hoisted prologue may start: after a shebang, after a directive prologue, and after the
 * leading comments.
 *
 * `"use client"` is a directive only while nothing precedes it, so prepending in front of one turns
 * it into an ordinary string expression and the file quietly stops being what it said it was. The
 * imports themselves need no such care — an `import` declaration is hoisted, so a `const` written
 * above one still sees its bindings.
 *
 * **And a leading COMMENT is where TypeScript reads its pragmas from**, which is the same fault one
 * step further out. `@jsxImportSource` in a file comment names a per-file JSX runtime — and this
 * package's `runtime` option exists for another JSX library, so the two meet in one file. Measured
 * on both transformers a build can use, with the import prepended above the comment: esbuild still
 * honours the pragma and **`tsc` falls back to `react/jsx-runtime`**, silently. `@ts-nocheck`,
 * `@ts-check` and `/// <reference … />` are read from the same place.
 *
 * So the prologue goes below the leading trivia rather than above it, which also leaves a licence
 * header where its author put it.
 */
function afterDirectives(source: string): number {
  let at = afterShebang(source);

  for (;;) {
    at = skipTrivia(source, at);
    // Past the comments, whether or not a directive follows them — see the note above.
    const from = at;
    const quote = source.charCodeAt(at);
    if (quote !== 34 && quote !== 39) return from;

    let index = at + 1;
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (code === 92) {
        index += 2;
        continue;
      }
      if (code === quote || code === 10) break;
      index++;
    }
    if (source.charCodeAt(index) !== quote) return from;

    index++;
    while (index < source.length && (source.charCodeAt(index) === 32 || source.charCodeAt(index) === 9)) index++;
    if (source.charCodeAt(index) === 59 /* ; */) index++;
    if (source.charCodeAt(index) === 13) index++;
    if (source.charCodeAt(index) !== 10) return from;
    at = index + 1;
  }
}

function skipTrivia(source: string, from: number): number {
  let at = from;
  while (at < source.length) {
    const code = source.charCodeAt(at);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 12) {
      at++;
      continue;
    }
    if (code === 47 && source.charCodeAt(at + 1) === 47) {
      at = nextLine(source, at);
      continue;
    }
    if (code === 47 && source.charCodeAt(at + 1) === 42) {
      const close = source.indexOf("*/", at + 2);
      at = close === -1 ? source.length : close + 2;
      continue;
    }
    break;
  }
  return at;
}

/** The start of the line after the one `from` is on, or the end of the source. */
function nextLine(source: string, from: number): number {
  const line = source.indexOf("\n", from);
  return line === -1 ? source.length : line + 1;
}
