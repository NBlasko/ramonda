/**
 * The CSS rules' findings as editor diagnostics, and the compiler's own diagnostics with the ones a
 * rule already said dropped.
 *
 * Part of the editor plugin — see `../plugin.ts`, which wires these into the language service.
 */
import { type Config } from "../../config/config";
import { type Finding, REPLACED_CODES, SPEAKS_OVER_TYPES } from "../../compiler/rules";
import { type Imported } from "../../compiler/references";
import { checkedSource } from "../../compiler/source";
import type ts from "typescript";

/**
 * The CSS rules' findings, as diagnostics an editor can draw.
 *
 * Their positions are already the author's — the rules read the author's own text, not the virtual
 * copy — so nothing is mapped.
 */
export function ours(
  findings: readonly Finding[],
  file: ts.SourceFile | undefined,
  /**
   * An ERROR, because the build refuses every finding these rules produce, and a yellow squiggle
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
 * `ramonda-css` drops the duplicate, and the editor has to as well, or one fault reads as two.
 *
 * Matched on POSITION, the way the command does it: the same fault at the same character is the
 * same fault, and a `TS2353` about a nested rule's key is at a position no property rule names.
 */
export function withoutRepeats(
  ours: readonly ts.Diagnostic[],
  theirs: readonly ts.Diagnostic[],
  text: string,
): ts.Diagnostic[] {
  /**
   * Every rule that says what the TYPES also refuse, from the list both consumers read.
   *
   * Without it the editor shows TWO messages for one fault: hovering a narrowed `z-index` shows the
   * rule's sentence beside a raw `Narrowed<…>`, and together they read as a contradiction.
   *
   * One list, `SPEAKS_OVER_TYPES` in `rules/index.ts`, read by both consumers, so the next rule
   * added cannot reach one and not the other.
   */
  /**
   * By DECLARATION, read off the TEXT — which is how `check.ts` does it, and the reason for both
   * halves.
   *
   * Not by offset, because the two land at different ones by construction: `unknown-property`
   * points at the property name and the compiler's `TS2561` does too — but `value-not-allowed`
   * points at the VALUE while `TS2322` points elsewhere in the declaration. Measured, matched on
   * `start`, every one still came back twice.
   *
   * Not by LINE, which is too much: an author puts as much on one as they like, and measured, a
   * one-line component swallowed `const n: number = "no"` because the block beside it had a
   * property typo. The declaration is the fault's own extent — the text back to the last `;` or
   * line break. A brace is NOT a boundary: a hole is written in braces, and counting them would
   * split one fault's two messages apart again.
   *
   * From the text rather than from `diagnostic.file`, because ours carry whatever source file the
   * cache held and a harness need not provide one — measured, `undefined` there made every key `-1`
   * and the set matched nothing.
   */
  const declarationOf = (diagnostic: ts.Diagnostic) => {
    const at = diagnostic.start;
    if (at === undefined) return -1;
    let start = 0;
    for (let index = 0; index < at && index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 59 || code === 10) start = index + 1;
    }
    return start;
  };

  const said = new Set(
    ours
      .filter((diagnostic) => SPEAKS_OVER_TYPES.some((rule) => String(diagnostic.messageText).startsWith(`[${rule}]`)))
      .map(declarationOf),
  );

  /**
   * `TS2561` too, which is the compiler's *did you mean* for a BARE property name.
   *
   * `unknown-property` reports bare names as well as dashed ones, because the BUILD runs no
   * TypeScript and must say it itself — so the editor drops the compiler's word the same way
   * `check.ts` does.
   */
  return theirs.filter(
    (diagnostic) => !(REPLACED_CODES.includes(diagnostic.code) && said.has(declarationOf(diagnostic))),
  );
}

/**
 * What the CSS rules say about a file, read from the author's own text.
 *
 * `checkedSource` is the sequence, shared with `ramonda-css check`, so a rule added there is
 * reported here too. The build runs the same rules through its own sequence in `transform`.
 *
 * TOLERANT, which is the one thing an editor needs differently: the build refuses a half-written
 * block outright, so by the time a build has spoken there is nothing left to squiggle.
 */
export function cssFindings(text: string, fileName: string, read: Imported["read"], config: Config): Finding[] {
  // Site rules — what is true of `className=@@( … )` rather than of the CSS in it — arrive through
  // here too, so a bare attribute is reported once.
  return checkedSource(text, fileName, { read, config, tolerant: true }).findings;
}
