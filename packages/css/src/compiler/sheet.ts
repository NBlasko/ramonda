import { CssBlockError } from "./errors";
import { sheetRank, withParent } from "./flatten";
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
  add(file: string, blocks: readonly EmittedBlock[]): void {
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
    let out = "";
    for (const [className, rule] of this.ownOrder(file)) {
      out += write(className, rule.block);
    }
    return out === "" ? "" : `@layer ramonda {\n${out}}\n`;
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
    if (this.rules.size === 0) return "";

    let out = "@layer ramonda {\n";
    for (const [className, rule] of ordered(this.rules)) out += write(className, rule.block);
    return `${out}}\n`;
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
