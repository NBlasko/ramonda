import { CssBlockError } from "./errors";
import { nearest } from "./rules";
import type { VariableRead, Variables } from "./variables";

/**
 * One file's custom properties, plus what its OWN config says exists outside the build.
 *
 * Carried per file rather than handed to the check once: a monorepo has a config per package, and a
 * name a design-system package declares is not declared in the app that consumes it.
 */
export interface FileVariables extends Variables {
  readonly known?: readonly string[];
}

/** One `var()` whose name nothing in the build sets, and the nearest name that is set. */
export interface UnknownVariable {
  readonly file: string;
  readonly read: VariableRead;
  readonly meant?: string;
}

/**
 * What to do about it, and it names every way because which one applies is the author's to know.
 *
 * Four things make a name known, and each is a different thing they did or did not do: a block sets
 * it, a `@@property` registers it, the config lists it because this compiler cannot see the
 * stylesheet that does, or the read carries a fallback — which is CSS's own way of saying the value
 * may be absent, and costs nothing.
 */
export function messageFor(one: UnknownVariable): string {
  return (
    `nothing in this build sets \`${one.read.name}\`.` +
    (one.meant === undefined ? "" : ` Did you mean \`${one.meant}\`?`) +
    `\n    Set it in a block, register it with \`@@property\`, add it to \`variables\` in ` +
    `\`ramonda.css.ts\` if it comes from a stylesheet this does not compile, or give it a ` +
    `fallback — \`var(${one.read.name}, <value>)\` — which says it may be absent.`
  );
}
import { BREADTH_LAYERS, DIGIT_LAYERS, LAYER_ORDER, layerPathFor, sheetRank, withParent } from "./flatten";
import { escapeClass } from "./names";
import type { EmittedBlock } from "./transform";

/**
 * The at-rules that take no name, so the hash has nowhere to go.
 *
 * `@keyframes r-…` names an animation something else refers to; `@font-face` names nothing — the
 * `font-family` inside it is what other rules match on. So a nameless rule is written bare, and its
 * identity is entirely its content, which is also what makes deduping it correct: two identical
 * `@font-face` blocks ARE one rule, and two different ones were never going to collide.
 */
const NAMELESS = new Set(["font-face"]);

/**
 * One rule, written out.
 *
 * A block from a named site is its own at-rule rather than a rule on a class, and the hash moves
 * from the selector into the at-rule's name — the one place an author's own CSS can refer to it.
 */
function write(className: string, block: EmittedBlock): string {
  if (block.at !== undefined) {
    if (NAMELESS.has(block.at)) return `@${block.at} { ${block.css} }\n`;
    return `@${block.at} ${className} { ${block.css} }\n`;
  }

  /**
   * The class ESCAPED, and written where the block's `&` stood — see `withParent`, which is also
   * what decides where that is. `:hover` is CSS's own punctuation and means what it says, while a
   * `#` inside the class name is a character the name happens to hold.
   *
   * An empty selector is the element itself, with no nested rule around it.
   */
  const self = `.${escapeClass(className)}`;
  const selector = block.selector === undefined || block.selector === "" ? self : withParent(block.selector, self);
  let rule = `${selector} { ${block.css} }`;
  // Outermost first, so they are written from the inside out.
  for (const condition of [...(block.conditions ?? [])].reverse()) rule = `${condition} { ${rule} }`;
  return `${rule}\n`;
}

/**
 * The rules of one sheet, in the order they are written out.
 *
 * Generic over what a rule carries beside its block, so nothing about the caller's shape is dropped
 * on the way through — the first version declared the parameter it read and silently narrowed the
 * rest away.
 *
 * The order itself is {@link sheetRank}, which lives beside the declarations because the checker
 * needs the same answer: `override-out-of-order` reports where this order contradicts the author's.
 * A STABLE sort, so anything the rank does not separate keeps the order it arrived in.
 */
function ordered<T extends { block: EmittedBlock }>(rules: Iterable<[string, T]>): [string, T][] {
  return [...rules].sort((a, b) => sheetRank(a[1].block) - sheetRank(b[1].block));
}

/** One level of the layer tree: the rules that stop here, and the levels under it. */
interface Level {
  readonly own: string[];
  readonly under: Map<string, Level>;
}

const level = (): Level => ({ own: [], under: new Map() });

/**
 * The names a level's children MAY hold, in order — which is what two files have to agree on.
 *
 * Read off the children rather than counted from the depth: every child of one level is the same
 * kind of step, because {@link layerPathFor} builds the path that way. The top level needs none —
 * {@link LAYER_ORDER} declares those, fully qualified, at the very start of the stylesheet.
 */
function namesUnder(under: Map<string, Level>): readonly string[] {
  const [first] = under.keys();
  if (first === undefined || first.startsWith("u") || first === "c") return [];
  return first.startsWith("d") ? DIGIT_LAYERS : BREADTH_LAYERS.map((one) => `b${one}`);
}

/**
 * Rules that are already in order, written out as a stylesheet: the layer statement, then the tree
 * of layers their ranks map to.
 *
 * **Why layers at all** is on {@link layerPathFor}, and the short of it is that a stylesheet is a
 * sequence while a layer is not: one rule is written into the stylesheet of every file that names
 * it, so the sequence depends on which chunk loaded first, and the rank's order was undone by an
 * unrelated component.
 *
 * Each level declares the names it MAY hold rather than the ones it does, which is what makes two
 * files agree; and the rules inside one layer keep the order they were given, so a reader of the
 * output still sees the order the sheet has always written.
 */
function wrap<T extends { block: EmittedBlock }>(rules: readonly [string, T][]): string {
  if (rules.length === 0) return "";

  const root = level();
  for (const [className, rule] of rules) {
    let here = root;
    for (const step of layerPathFor(rule.block)) {
      let next = here.under.get(step);
      if (next === undefined) {
        next = level();
        here.under.set(step, next);
      }
      here = next;
    }
    here.own.push(write(className, rule.block));
  }

  const written = (here: Level): string => {
    let out = here.own.join("");
    if (here.under.size === 0) return out;

    const names = namesUnder(here.under);
    if (names.length > 0) out += `@layer ${names.join(",")};\n`;
    for (const [step, under] of here.under) out += `@layer ${step} {\n${written(under)}}\n`;
    return out;
  };

  return `${LAYER_ORDER}\n@layer ramonda {\n${written(root)}}\n`;
}

/**
 * What post-processing has to hand back for this rule to have survived.
 *
 * A class rule is found by its selector, a named one by the name the emitted JavaScript holds, and a
 * nameless one by the only thing it has — its at-rule, which a minifier may not invent or drop.
 */
function nameIn(className: string, block: EmittedBlock): string {
  // Escaped, because that is what a stylesheet holds — looking for the raw name would find nothing
  // and fail every build the moment a name became readable.
  if (block.at === undefined) return `.${escapeClass(className)}`;
  return NAMELESS.has(block.at) ? `@${block.at}` : className;
}

/**
 * The stylesheet, assembled from every block the transform found.
 *
 * The transform is deliberately local: it reads one file and knows nothing about any other, which is
 * what makes it cacheable, incremental and parallel. **Every question that needs the whole picture
 * therefore lives here**, and there are exactly three of them:
 *
 * 1. **Dedupe.** Identical blocks are one rule. Global and coordination-free, because agreeing on
 *    the same answer is what a hash is for — two people who never spoke write the same declarations
 *    and get the same class.
 * 2. **The collision assertion.** No two DISTINCT blocks may share a class. A longer hash makes a
 *    collision unlikely, not impossible, and probability is not a promise — this is the promise.
 * 3. **The round trip.** After post-processing, every class the transform emitted must still be
 *    present and every `var(--…)` still referenced.
 *
 * ## Why it is keyed by file, and why each file gets its own CSS
 *
 * Two reasons, and the second was measured rather than reasoned.
 *
 * **A dev server re-transforms one file on every save**, and a block the author deleted has to leave
 * the sheet with it. Accumulating rules would mean a sheet that only ever grows during a session, and
 * a class name that stays claimed after nothing uses it — which would make editing a block collide
 * with the name it used to have.
 *
 * **And a bundler does not wait for the transform to finish.** Measured on a real Vite build: an
 * entry importing one shared stylesheet loaded that module BEFORE the styled file was transformed,
 * so the sheet was empty, so no CSS reached the output at all — a green build with an unstyled page.
 * So the sheet is asked per file, and the plugin appends the import to the file that produced the
 * rules. The ordering problem disappears, an app imports nothing, and the CSS follows the JavaScript
 * chunk — which is what per-route splitting needs and is now free.
 *
 * ## Dedupe is a shared CLASS, not a single copy of the rule — and that was a correction
 *
 * The first design gave each rule an OWNER: the first file to claim a class emitted it, and every
 * later file merely named it. One rule in the whole build, which is correct exactly as long as every
 * stylesheet loads together.
 *
 * **Measured, and it does not.** Two lazily-loaded routes writing the same block came out of a real
 * build as one chunk carrying the rule and another carrying a `.js` that names a class **no
 * stylesheet in the build contains**. A visitor landing on the second route saw the element render
 * unstyled, with no error anywhere — the failure this whole file exists to prevent, arriving by the
 * one door nobody was watching. In a dev server it had a second shape: a file that dropped a shared
 * block took the rule away from a file that never changed, because ownership had passed to a module
 * with no import to reload.
 *
 * So **a file serves every rule it NAMES**. What is deduped is the class: identical blocks agree on
 * one name, the markup is identical, and the browser applies one rule. What is duplicated is the
 * rule TEXT, once per file that writes the block — which the bundler then places in whichever chunks
 * need it, because that is a decision it already makes for every other module.
 */
export class Sheet {
  /** File → the classes it currently contributes, in source order. */
  private readonly byFile = new Map<string, string[]>();
  /**
   * Class → the rule and every file that names it.
   *
   * Insertion order is the sheet's order. There is no owner: every one of those files serves the
   * rule, because a file's stylesheet has to stand on its own wherever its chunk lands.
   */
  private readonly rules = new Map<string, { block: EmittedBlock; files: Set<string> }>();
  /**
   * File → the custom properties it sets and reads, for the check no single file can make.
   *
   * Keyed by file and replaced whole, for the same reason the rules are: on a save, a name the
   * author deleted has to go.
   */
  private readonly variables = new Map<string, FileVariables>();

  /** What a file with no blocks contributes: nothing, which is a value rather than an absence. */
  private static readonly NONE: FileVariables = Object.freeze({ set: [], read: [] });

  /**
   * What one file contributes, replacing whatever it contributed before.
   *
   * Replacing rather than adding is the whole reason this is keyed by file: on a save, the blocks the
   * author deleted have to go, and only this knows which those were.
   *
   * **Nothing else's CSS moves.** A file serves what it names, so one file's edit cannot change what
   * another file serves — which is why this returns nothing, and why the dev server needs no
   * cross-file invalidation. It used to: ownership meant a file that dropped a shared block took the
   * rule away from a file nobody had touched, and telling that file was a whole mechanism. Measured
   * to be broken anyway, since a file owning nothing at the moment it was transformed had no
   * stylesheet import to reload.
   */
  add(file: string, blocks: readonly EmittedBlock[], variables: FileVariables = Sheet.NONE): void {
    /**
     * Replaced whether or not any were handed over, and the guard that used to stand here made this
     * half true. A file's rules were replaced on every call and its variables only when the caller
     * had some — so an adapter saying "this file has nothing left", which is exactly what it says
     * when the author deletes the last block, left the file's last known names in place for the life
     * of the process. Measured both ways: a name nothing sets any more stayed known, and a typo the
     * author had already deleted kept failing the build.
     */
    this.variables.set(file, variables);

    for (const className of this.byFile.get(file) ?? []) {
      const rule = this.rules.get(className);
      if (rule === undefined) continue;
      rule.files.delete(file);
      // Nothing asks for it any more, so the NAME is free again. Keeping the rule would make editing
      // a block collide with the name it used to have, until the server restarted.
      if (rule.files.size === 0) this.rules.delete(className);
    }

    const claimed: string[] = [];
    for (const block of blocks) {
      const existing = this.rules.get(block.className);

      if (existing === undefined) {
        this.rules.set(block.className, { block, files: new Set([file]) });
        claimed.push(block.className);
        continue;
      }

      /**
       * Two different blocks under one name. **This is the guarantee the hash length only makes
       * unlikely**, and it fails the build rather than picking one — either rule would be wrong on
       * somebody's element, and the wrongness is a style that silently does not apply.
       *
       * Both files are named because either one could be the one to change: nothing here can know
       * which block was there first in any sense the author would recognise.
       */
      /**
       * The whole rule, not its body alone.
       *
       * Two rules with identical CSS and different CONTEXTS are two rules — `.r-x{color:red}` and
       * `.r-x:hover{color:red}` — and comparing bodies could not tell them apart. That is not
       * hypothetical: it is the fault this assertion missed until the class name started hashing the
       * context too, and an assertion that cannot see the fault it exists for is worth nothing.
       */
      if (write(block.className, existing.block) !== write(block.className, block)) {
        const other = [...existing.files].join(", ") || "another file";
        throw new CssBlockError(
          `two different style blocks hash to \`${block.className}\`, one in ${other} and one here. ` +
            `A class name is the hash of the block, so this cannot happen by accident — please report it.`,
          file,
          1,
          1,
        );
      }

      existing.files.add(file);
      claimed.push(block.className);
    }

    this.byFile.set(file, claimed);
  }

  /**
   * The CSS one file needs: every rule it names, in THAT FILE's own order.
   *
   * **Every** rule, including one another file also writes — see the note at the top. A stylesheet
   * that leaves out a class its own JavaScript names is a stylesheet that is only correct when some
   * other chunk happens to have loaded, and a bundler makes no such promise.
   *
   * **The order is the file's, and it used to be the sheet's.** This walked the whole rule map and
   * filtered it, so what came out was global first-claim order — whichever file the bundler happened
   * to transform first. A review measured it: two files writing the same two conditional
   * declarations in opposite orders, and the second one's stylesheet came out in the FIRST one's
   * order, while compiled alone it came out in its own.
   *
   * `sheetRank` cannot rescue that. It separates conditional from unconditional and broad from
   * narrow; it says nothing about one condition against another, so the two ranks are equal, the
   * stable sort kept an order belonging to another file, and `override-out-of-order` had nothing to
   * report because nothing about the RANKS was wrong. The declaration that lost was silently the
   * wrong one, and which one it was depended on build order.
   *
   * `byFile` has kept each file's claims in source order since it was written, for a different
   * reason — knowing what to withdraw on a save. That is the order the author wrote, so it is the
   * order to emit, with the rank sorting within it as it always did.
   */
  cssFor(file: string): string {
    return wrap(this.ownOrder(file));
  }

  /** This file's own claims, in the order it wrote them, sorted by {@link sheetRank} within that. */
  private ownOrder(file: string): [string, { block: EmittedBlock; files: Set<string> }][] {
    const mine: [string, { block: EmittedBlock; files: Set<string> }][] = [];
    for (const className of this.byFile.get(file) ?? []) {
      const rule = this.rules.get(className);
      // A class this file claimed that nothing names any more — `add` deletes such a rule, and this
      // is read between edits. Skipped rather than trusted to be there.
      if (rule !== undefined) mine.push([className, rule]);
    }
    return ordered(mine);
  }

  /**
   * The sheet.
   *
   * **One named layer, and everything in it.** A layer sits beneath all unlayered CSS — which is
   * every hand-written stylesheet — so an author's own `.card { display: block }` wins over a
   * generated rule whatever order the files load in, and nobody has to reason about specificity
   * against generated output.
   *
   * Nested rules and at-rules are written through verbatim: they were parsed, normalised and
   * substituted upstream, and nesting is what CSS itself resolves.
   */
  css(): string {
    return wrap(ordered(this.rules));
  }

  /**
   * A `var()` READING a name nothing in this build sets.
   *
   * **The only place this question can be answered.** A name may be set by a block three components
   * away, so no single file knows; the sheet is what has every file at once. `variable-read-by-
   * another-name` used to guess at it from inside one block — it reported a name a few edits from
   * one the SAME block set, which made it a typo detector that could not see a real global and
   * reported correct CSS whenever a project's global name resembled a local one.
   *
   * Four things make a name known, and each is a different thing the author did:
   *
   * - **a block sets it**, anywhere in the build, which covers a parent setting what a child reads;
   * - **a `@@property` registers it**, which carries an `initial-value` and so always resolves;
   * - **the config lists it**, which is the escape for a name this compiler cannot see — a
   *   stylesheet it does not compile, or one set from JavaScript;
   * - **the read carries a FALLBACK**, `var(--brand, #10b981)`, which is CSS's own way of saying the
   *   value may be absent. It costs nothing and is the CSS an author writes anyway.
   *
   * The message names all four, because which one applies is the author's to know and not ours to
   * guess. A near miss among the names the build DOES set is offered beside them — from every name
   * in the build now, rather than from one block's.
   */
  verifyVariables(): void {
    const unknown = this.unknownVariables();
    if (unknown.length === 0) return;

    const [first] = unknown;
    throw new CssBlockError(
      messageFor(first) + (unknown.length === 1 ? "" : `\n    ${unknown.length - 1} more like it.`),
      first.file,
      1,
      1,
    );
  }

  /**
   * The same answer as a LIST, for a caller that can put each one where it was written.
   *
   * `ramonda-css check` reports findings with a line and a column; a bundler has no such report and
   * stops the build with the first. One computation, two ways of saying it.
   */
  unknownVariables(): UnknownVariable[] {
    const set = new Set<string>();
    for (const [, variables] of this.variables) for (const name of variables.set) set.add(name);

    const unknown: { file: string; read: VariableRead }[] = [];
    for (const [file, variables] of this.variables) {
      // The config that governs THIS file, not a union of every config in the build — a monorepo has
      // one per package, and a name declared in one package is not declared in the next.
      const declared = variables.known ?? [];
      for (const read of variables.read) {
        if (read.fallback || set.has(read.name) || declared.includes(read.name)) continue;
        unknown.push({ file, read });
      }
    }
    const among = [...set];
    return unknown.map((one) => ({ ...one, meant: nearest(one.read.name, among) }));
  }

  /**
   * What the sheet promised, asked of whatever came back from post-processing.
   *
   * A minifier is allowed to merge and rename rules, and the markup already names the classes — so a
   * rule that vanished or was renamed means shipping HTML pointing at a class that is not there. The
   * failure is invisible: the page renders, unstyled, with nothing to blame.
   *
   * A substring test, not a parse. Merging keeps the name (`.a,.r-… { … }`), and the question is only
   * whether the name survived at all — which is what a rename or a drop destroys and nothing else
   * does.
   */
  verify(processed: string, where = "the assembled stylesheet"): void {
    const missing: string[] = [];
    /**
     * How many rules of each NAMELESS at-rule the sheet holds.
     *
     * A class is asked for by its selector and a `@keyframes` by its name; a `@font-face` has
     * neither, so two of them look exactly like one to a substring test. Measured before this was
     * written: with two in the sheet and one dropped, `verify` passed and said nothing. The promise
     * is that every rule survived, so for these the question is how many.
     */
    const nameless = new Map<string, number>();
    for (const rule of this.rules.values()) {
      const at = rule.block.at;
      if (at !== undefined && NAMELESS.has(at)) nameless.set(at, (nameless.get(at) ?? 0) + 1);
    }

    for (const [at, expected] of nameless) {
      const found = processed.split(`@${at}`).length - 1;
      if (found >= expected) continue;
      missing.push(`${expected - found} of the ${expected} \`@${at}\` rule(s) — ${found} came back`);
    }

    for (const [className, rule] of this.rules) {
      const wanted = nameIn(className, rule.block);
      // Counted above, together, because one of these cannot be told from another by name.
      if (rule.block.at !== undefined && NAMELESS.has(rule.block.at)) continue;
      if (!processed.includes(wanted)) {
        missing.push(rule.block.at === undefined ? `the class \`${className}\`` : `the rule \`${wanted}\``);
        continue;
      }
      for (const property of rule.block.properties) {
        if (!processed.includes(`var(${property})`)) missing.push(`\`var(${property})\`, promised by \`${className}\``);
      }
    }

    if (missing.length === 0) return;

    throw new CssBlockError(
      `post-processing dropped ${missing.length} thing(s) the markup already names:\n` +
        missing.map((each) => `      ${each}`).join("\n") +
        `\n    A class name is written into the emitted JavaScript, so a rule that was renamed or ` +
        `removed ships a page pointing at nothing. Post-processing may merge; it may not rename.`,
      where,
      1,
      1,
    );
  }
}
