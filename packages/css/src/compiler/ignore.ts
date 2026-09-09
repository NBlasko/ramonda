import { positionOf } from "./errors";
import type { Finding } from "./rules";

/** What the marker is spelled, and it is the same word in a CSS comment and in a JavaScript one. */
const MARKER = "ramonda-css-ignore";

/** One directive the author wrote, and what it says. */
export interface Ignored {
  /** The line the directive applies to — the one after it. 1-based, as a person counts. */
  readonly line: number;
  /** Why, in the author's own words. Never empty: an empty one is refused rather than obeyed. */
  readonly reason: string;
  /** Where the directive itself is, so a run can list it. */
  readonly at: number;
}

/**
 * The findings an author has taken responsibility for, and the record of having done so.
 *
 * **Every rule in this package fails a build, and until now nothing could stop one.** That is only
 * bearable while no rule is ever wrong, and the first one that is wrong once means a person switches
 * the whole tool off — which is worse than any finding it could have made. The framework's own
 * checker has had `// ramonda-check-ignore <reason>` since severities were removed; this is the same
 * thing for the same reason, and it lives HERE rather than there because `@ramonda/css` is meant to
 * be usable from another JSX library, where nothing of the framework is installed.
 *
 * Three things make it a record rather than a silence, and all three are the framework's:
 *
 * - **it is line scoped**, so it cannot creep past what the author looked at;
 * - **an empty reason is refused**, because a directive with nothing after it is a silence;
 * - **every annotated site is returned**, so a run can print what was exempted and nobody has to
 *   grep for them to find out.
 *
 * The scan is by LINE and reads no comment syntax, which is deliberate: a block is CSS and the code
 * around it is TypeScript, so a directive has to work in `/* … *\/` and in `//` without this having
 * to know which it is in. The cost is that the marker written inside a string would also count —
 * the same cost every linter's disable comment has, and the same defence: it is the author's own
 * text, saying the author's own words.
 */
export function ignoredIn(source: string): { ignored: Ignored[]; findings: Finding[] } {
  const ignored: Ignored[] = [];
  const findings: Finding[] = [];
  if (!source.includes(MARKER)) return { ignored, findings };

  let at = 0;
  let line = 1;
  for (const text of source.split("\n")) {
    const found = text.indexOf(MARKER);
    if (found !== -1) {
      const reason = text
        .slice(found + MARKER.length)
        .replace(/\*\/.*$/, "")
        .trim();

      if (reason === "") {
        findings.push({
          rule: "ignore-without-a-reason",
          at: at + found,
          length: MARKER.length,
          message:
            "a `ramonda-css-ignore` with no reason after it is a silence, not a record. Write why " +
            "this has to stay — every one of them is printed on every run, so a reason that stops " +
            "being true is one somebody can see.",
        });
      } else {
        ignored.push({ line: line + 1, reason, at: at + found });
      }
    }
    at += text.length + 1;
    line++;
  }

  return { ignored, findings };
}

/** Whether a finding sits on a line an author took responsibility for. */
export function isIgnored(source: string, ignored: readonly Ignored[], finding: Finding): boolean {
  if (ignored.length === 0) return false;
  const { line } = positionOf(source, finding.at);
  return ignored.some((one) => one.line === line);
}
