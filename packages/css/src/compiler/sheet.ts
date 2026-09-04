import { CssBlockError } from "./errors";
import type { EmittedBlock } from "./transform";

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
 * **Dedupe survives that**, and {@link cssFor} is how: the first file to claim a class OWNS the rule,
 * and a later file naming the same block gets nothing for it. One rule, wherever it is written.
 */
export class Sheet {
  /** File → the classes it currently contributes, in source order. */
  private readonly byFile = new Map<string, string[]>();
  /**
   * Class → the rule, every file that asks for it, and the one whose CSS module carries it.
   *
   * Insertion order is the sheet's order. `owner` is what makes dedupe work while each file serves
   * its own CSS: exactly one file emits the rule, and everyone else just names the class.
   */
  private readonly rules = new Map<string, { block: EmittedBlock; files: Set<string>; owner: string }>();

  /**
   * What one file contributes, replacing whatever it contributed before, and **which files' CSS
   * changed as a result**.
   *
   * Replacing rather than adding is the whole reason this is keyed by file: on a save, the blocks the
   * author deleted have to go, and only this knows which those were.
   *
   * The return value is the other half. A file that stops using a block hands ownership of that rule
   * to whoever else still names it, so the CSS of a file nobody touched can change — and a dev server
   * has no way to know that unless it is told.
   */
  add(file: string, blocks: readonly EmittedBlock[]): Set<string> {
    /** Whose CSS is now different. The file being added is in it whenever anything about it moved. */
    const changed = new Set<string>();
    const ownerBefore = new Map<string, string>();
    for (const [className, rule] of this.rules) ownerBefore.set(className, rule.owner);

    for (const className of this.byFile.get(file) ?? []) {
      const rule = this.rules.get(className);
      if (rule === undefined) continue;
      rule.files.delete(file);
      // Nothing asks for it any more, so the NAME is free again. Keeping the rule would make editing
      // a block collide with the name it used to have, until the server restarted.
      if (rule.files.size === 0) {
        this.rules.delete(className);
        continue;
      }
      // Somebody else still names it. Ownership passes to whichever of them claimed it first, which
      // is the order the set preserves.
      if (rule.owner === file) rule.owner = [...rule.files][0];
    }

    const claimed: string[] = [];
    for (const block of blocks) {
      const existing = this.rules.get(block.className);

      if (existing === undefined) {
        this.rules.set(block.className, { block, files: new Set([file]), owner: file });
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
      if (existing.block.css !== block.css) {
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

    for (const [className, rule] of this.rules) {
      if (ownerBefore.get(className) !== rule.owner) changed.add(rule.owner);
    }
    for (const [className, owner] of ownerBefore) {
      // A rule that is gone: whoever used to serve it is serving less now.
      if (!this.rules.has(className)) changed.add(owner);
    }
    return changed;
  }

  /**
   * The CSS one file is responsible for: the rules it OWNS, and nothing it merely names.
   *
   * This is where dedupe and per-file serving meet. A block written in two files is claimed by both
   * and owned by one, so it is emitted once — and the file that owns it is the one whose chunk the
   * rule lands in, which is what makes splitting a decision the bundler already made.
   */
  cssFor(file: string): string {
    let out = "";
    for (const [className, rule] of this.rules) {
      if (rule.owner === file) out += `.${className} { ${rule.block.css} }\n`;
    }
    return out === "" ? "" : `@layer ramonda {\n${out}}\n`;
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
    for (const [className, rule] of this.rules) out += `.${className} { ${rule.block.css} }\n`;
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

    for (const [className, rule] of this.rules) {
      if (!processed.includes(`.${className}`)) {
        missing.push(`the class \`${className}\``);
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
