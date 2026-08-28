import { readFileSync, writeFileSync } from "node:fs";
import type { Findings } from "./analyze";
import type { TextEdit } from "./rules/rule";

/**
 * Applying the edits a run produced, or saying what applying them would do.
 *
 * The checker knows the answer to a few of the faults it reports — `httpEquiv` becomes
 * `http-equiv`, and there is nothing to decide — and until now it printed a sentence and left
 * somebody to type it. This is the other half.
 *
 * ## Everything here is about not being wrong
 *
 * A wrong report costs a reader a minute. A wrong EDIT costs them a revert, and worse, it costs
 * them their trust in every edit that was right. So:
 *
 * - only a rule that carries an edit is applied, and a rule carries one only where the fix has a
 *   single answer;
 * - **overlapping edits are dropped, not merged.** Two rules wanting the same span disagree about
 *   what that span should say, and picking one is guessing;
 * - edits are applied back to front, so an earlier one cannot move a later one's offsets;
 * - a file is written once, or not at all.
 */
export interface FixResult {
  /** How many edits were applied, or would be. */
  applied: number;
  /** Files touched, in the order they were read. */
  files: string[];
  /** Edits dropped because another edit wanted the same characters. */
  overlapping: number;
  /** One line per edit, for a run that is only reporting. */
  said: string[];
}

/** Everything a run reported that carries an edit, grouped by the file it belongs to. */
function editsByFile(findings: Findings): Map<string, TextEdit[]> {
  const byFile = new Map<string, TextEdit[]>();

  for (const issues of Object.values(findings)) {
    for (const issue of issues as readonly { file: string; edit?: TextEdit }[]) {
      if (issue.edit === undefined) continue;
      const held = byFile.get(issue.file);
      if (held === undefined) byFile.set(issue.file, [issue.edit]);
      else held.push(issue.edit);
    }
  }

  return byFile;
}

/**
 * The edits that can be applied together, and a count of the ones that cannot.
 *
 * Sorted back to front so applying one cannot move the next one's offsets — the reason every editor
 * that does this does it that way. An edit that starts before the previous one ended wants
 * characters something else has already claimed, and the two disagree about what those characters
 * should say. Neither is applied: picking the first, or the longer, or the one from the rule that
 * happens to be registered earlier, is a coin toss wearing a rule's name.
 */
function withoutOverlaps(edits: readonly TextEdit[]): { safe: TextEdit[]; dropped: number } {
  const sorted = [...edits].sort((a, b) => b.from - a.from || b.to - a.to);

  const safe: TextEdit[] = [];
  let dropped = 0;
  let claimedFrom = Number.POSITIVE_INFINITY;

  for (const edit of sorted) {
    if (edit.to > claimedFrom) {
      dropped += 1;
      continue;
    }
    safe.push(edit);
    claimedFrom = edit.from;
  }

  return { safe, dropped };
}

/**
 * Apply every edit a run produced, or report what applying them would do.
 *
 * `write: false` is the whole of `--dry-run`: the same work, the same answers, and nothing on disk
 * changes. It is separated by a flag rather than by a second function so the two cannot come apart.
 */
export function applyFixes(findings: Findings, write: boolean): FixResult {
  const byFile = editsByFile(findings);

  const result: FixResult = { applied: 0, files: [], overlapping: 0, said: [] };

  for (const [file, edits] of byFile) {
    const { safe, dropped } = withoutOverlaps(edits);
    result.overlapping += dropped;
    if (safe.length === 0) continue;

    /**
     * The BOM, and it is the one place these two readers disagree.
     *
     * TypeScript STRIPS a byte-order mark when it reads a file, so every offset a rule produced is
     * relative to the text without it. `readFileSync` keeps it, as a single `\uFEFF`. Slicing the
     * kept text with the stripped text's offsets puts every edit one character early — measured:
     * `<div class="card">` came back `<divclassNames="card">`, having eaten the space and left the
     * `s` behind. Silent, and in a tool that writes somebody's source.
     *
     * Stripped here and put back on write, so the file keeps whatever it had. CRLF needs no such
     * handling and was checked: TypeScript keeps `\r\n` in its text, so the offsets already agree.
     */
    const raw = readFileSync(file, "utf8");
    const bom = raw.charCodeAt(0) === 0xfeff ? "\uFEFF" : "";
    let source = bom === "" ? raw : raw.slice(1);

    for (const edit of safe) {
      source = source.slice(0, edit.from) + edit.text + source.slice(edit.to);
      result.said.push(`${file} — ${edit.says}`);
    }

    if (write) writeFileSync(file, bom + source, "utf8");
    result.applied += safe.length;
    result.files.push(file);
  }

  return result;
}
