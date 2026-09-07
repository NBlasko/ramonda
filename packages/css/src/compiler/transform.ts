import MagicString from "magic-string";
import { segments } from "./flatten";
import { SHORTHANDS } from "./keywords.generated";
import { classNameFor, nameFor, substitute, variableNameFor } from "./names";
import type { Config } from "../config";
import { type Imported, importedSites, namedSites, syntaxesIn } from "./references";
import { normalise } from "./normalise";
import { type Span, readBlock } from "./read";
import { refuse } from "./errors";
import { checkBlock, checkText } from "./rules";
import { type BlockSite, findBlocks, mayHoldABlock } from "./scan";

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
   * its own unsaved buffer, and a name here is a hash of the module's TEXT. Two consumers reading
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
/**
 * The at-rules a named site may declare.
 *
 * Each names something the whole stylesheet uses, which is exactly why it cannot live inside a block
 * — measured, `@keyframes` written in one compiles to a rule no browser resolves. Written here it
 * goes to the sheet under a generated name, and the site becomes that name as a value a block reads.
 */
const NAMED = new Set(["keyframes", "font-face", "property"]);

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
  const syntaxes = syntaxesIn(source);
  const resolve = (expression: string): string | undefined => references.get(expression);

  const magic = new MagicString(source);
  const block = binding(source, "_merge");
  const prefix = identifierPrefix(source);

  /** Class -> the atomic rule, so a declaration written a hundred times is one rule. */
  const atoms = new Map<string, EmittedBlock>();
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
      const read = readBlock(text, site.open, filename, { tolerant: true });
      const canonical = normalise(read.block);
      const className = site.at === "property" ? `--${classNameFor(canonical)}` : classNameFor(canonical);
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

    if (site.at !== undefined && !NAMED.has(site.at)) {
      refuse(
        `\`@@${site.at}( … )\` is not something this compiles — the named forms are ` +
          `${[...NAMED].map((one) => `\`@@${one}( … )\``).join(", ")}.`,
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
     * A hole is a custom property ON AN ELEMENT, and a named site has no element — an animation is
     * applied to whatever names it, and a font face to nothing at all. Compiling one would read a
     * value from wherever the rule happened to land, which is not a thing anybody meant.
     */
    if (site.at !== undefined && read.holes.length > 0) {
      refuse(
        `a hole cannot go in \`@@${site.at}( … )\` — a hole is a custom property on an ELEMENT, and ` +
          `this names something the whole stylesheet uses.`,
        source,
        read.holes[0].start,
        filename,
      );
    }

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
    const [finding] = [
      ...checkText(source, site.open, read.end),
      ...checkBlock(read.block, { at: site.at, references, syntaxes, config: options.config }),
    ].sort((a, b) => a.at - b.at);
    if (finding !== undefined) refuse(finding.message, source, finding.at, filename);

    // Normalised ONCE. It was called twice — for the name and again for the rule — and normalisation
    // walks the whole block, so that was a second full pass per block for a string already in hand.
    const canonical = normalise(read.block);
    /**
     * A `@property` registers a CUSTOM property, and a custom property is spelled with two dashes.
     * `@property r-… { … }` is not a rule any browser keeps, so the dashes are part of the name —
     * in the stylesheet, and in the string the site compiles to.
     */
    const className = site.at === "property" ? `--${classNameFor(canonical)}` : classNameFor(canonical);
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
     *     @@if ({off}) { cursor: none; @@if ({roomy}) { color: yellow } }
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
    const all = [...segments(read.block)];

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
         * always. A GUARD is fine and is allowed: `@@if` changes no key, it only decides whether the
         * whole map lands.
         */
        if (segment.selector !== "" || segment.conditions.length > 0) {
          refuse(
            "a spread merges a whole block, and a block carries the context its own declarations " +
              "were written in — so it cannot go inside a selector or a `@media`. Write it at the " +
              "top level of the block, or inside `@@if { … }`, which changes no declaration.",
            source,
            segment.at ?? site.start,
            filename,
          );
        }
        expression();
        continue;
      }

      piece += "{";
      for (const declaration of segment.items) {
        // Readable where one can be written, the hash where it cannot — see `nameFor`, which is
        // where the whole identity is hashed when it comes to that.
        const own = nameFor(declaration);
        const variables = declaration.holes.map((_hole, index) => variableNameFor(own, index));

        if (!atoms.has(own)) {
          atoms.set(own, {
            className: own,
            css: substitute(declaration.canonical, own),
            properties: variables,
            property: declaration.property,
            selector: declaration.selector,
            conditions: declaration.conditions,
          });
        }

        piece += `${JSON.stringify(declaration.key)}:`;
        if (declaration.holes.length === 0) piece += `${JSON.stringify(own)},`;
        else {
          piece += `[${JSON.stringify(own)},`;
          for (let index = 0; index < declaration.holes.length; index++) {
            expression();
            piece = index === declaration.holes.length - 1 ? "]," : ",";
          }
        }

        /**
         * What this declaration clears, when it is a shorthand — full KEYS, so a `padding` inside a
         * `@media` clears the `padding-left` inside that one and not the one outside it.
         *
         * Emitted only for the shorthands a block actually writes, which is what keeps a table of 78
         * out of every page.
         */
        const clears = SHORTHANDS[declaration.property];
        if (clears !== undefined) {
          const context = declaration.key.slice(0, declaration.key.length - declaration.property.length);
          piece += `${JSON.stringify(`~${declaration.key}`)}:${JSON.stringify(clears.map((one) => context + one))},`;
        }
      }
      piece += "}";
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
      : `import { merge as ${block} } from "${options.runtime ?? "@ramonda/css"}";\n` +
        `${[...hoisted].map(([map, id]) => `const ${id} = ${block}(${map});`).join("\n")}\n\n`;

  const top = afterDirectives(source);
  if (top === 0) magic.prepend(prologue);
  else magic.appendRight(top, prologue);

  return {
    code: magic.toString(),
    map: magic.generateMap({ source: filename, includeContent: true, hires: "boundary" }) as unknown as SourceMap,
    blocks: [...emittedNamed, ...atoms.values()],
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
 * Where the hoisted prologue may start: after a shebang and after a directive prologue.
 *
 * `"use client"` is a directive only while nothing precedes it, so prepending in front of one turns
 * it into an ordinary string expression and the file quietly stops being what it said it was. The
 * imports themselves need no such care — an `import` declaration is hoisted, so a `const` written
 * above one still sees its bindings.
 */
function afterDirectives(source: string): number {
  let at = source.startsWith("#!") ? nextLine(source, 0) : 0;

  for (;;) {
    const from = at;
    at = skipTrivia(source, at);
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
