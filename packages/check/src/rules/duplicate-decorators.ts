import ts from "typescript";
import { decoratorName, positionOf } from "../syntax";
import type { Rule } from "./rule";

/**
 * A decorator that answers a question with ONE answer, declared more than once on the same class.
 *
 * `@catchError` ("who handles an error from below?"), `@Host` ("which element am I?"),
 * `@ShouldUpdateOnPropsChange` ("take these props?") and `@StableProps` are each single. Declared
 * twice, one of them wins and the others never run — silently, and the one being read may be the dead
 * one. The framework reports what it can at runtime (RMD032 for `@catchError`, RMD040 for
 * `@ShouldUpdateOnPropsChange`), but only once the class is reached; a class behind a condition nobody
 * clicked ships with the fault.
 *
 * **Which one wins depends on the KIND of decorator, and the two are opposite.** One rule underneath
 * both: the last declaration APPLIED is the one that stands. A member decorator initialises
 * top-to-bottom, so the LOWEST is applied last and wins. A class decorator is applied bottom-up, so the
 * HIGHEST wins. Measured in core, in `CatchErrorDecorator.test.tsx` and `PropsGateInheritance.test.tsx`
 * — which is why `kind` is on this issue: without it a report cannot name the declaration that is
 * actually in effect, and naming the wrong one sends a reader to delete the line that works.
 *
 * A SUBCLASS declaring its own is not this. That is an override — the way a role is specialised —
 * so only declarations on one class body are counted.
 */
export interface DuplicateDecoratorIssue {
  /** The class the duplicates are on. */
  component: string;
  /** The decorator's name, without the `@`. */
  decorator: string;
  /** How many times it appears on this class. */
  count: number;
  /**
   * Where the decorator sits, which decides which of the duplicates is in effect — see above.
   *
   * Taken from the node it was found on rather than from a table of names, so it stays true when a
   * decorator changes form (`@ShouldUpdateOnPropsChange` was a member decorator before it was a class
   * one). A pair split across both kinds cannot arise: a decorator's own type refuses the position it
   * was not written for.
   */
  kind: "class" | "member";
  /**
   * What the second declaration DOES, which decides what advice makes sense.
   *
   * Four, one per behaviour core actually has, because the advice differs for each and naming the wrong
   * one sends a reader somewhere there is nothing to find:
   *
   * - `refuses` — it THROWS (`@Host`, RMD045). Nothing runs, so there is no live line to hunt for.
   * - `displaces` — one wins and the rest are dead code (`@catchError` RMD032,
   *   `@ShouldUpdateOnPropsChange` RMD040). The reader needs to know WHICH is live.
   * - `merges` — both take effect and the result is the union (`@StableProps`, RMD046). Nothing is lost;
   *   the spelling is redundant.
   * - `redundant` — the second changes nothing at all (`@state`, `@compute`, `@persist`,
   *   `@memoized`). No dead code and no behaviour to look for; delete the extras.
   */
  effect: "refuses" | "displaces" | "merges" | "redundant";
  /**
   * The member the duplicates sit on, for a `redundant` report — `n` in `@state @state n = 1`.
   *
   * Absent for `displaces`, where the count is per class and naming one member would be misleading:
   * two `@catchError` are on two different methods, and the fault is that the class has two answers.
   */
  member?: string;
  file: string;
  line: number;
  column: number;
}

/**
 * A second declaration REFUSES the program: it throws, so nothing runs at all.
 *
 * `@Host` only. Two element names have no union and no winner worth picking, so core raises `RMD045` and
 * throws in every build. Reporting it as "one of them wins" would be worse than saying nothing — the
 * reader would go looking for which line is live when the answer is that the class never loads.
 */
const REFUSING = new Set(["Host"]);

/**
 * A second declaration DISPLACES the first: one wins, the rest never run, and the program carries on
 * wrongly. That is what a runtime code without a throw is for — `RMD032` and `RMD040`.
 *
 * Counted per CLASS BODY, so a subclass declaring its own — an override — is not a duplicate.
 */
const DISPLACING = new Set(["catchError", "ShouldUpdateOnPropsChange"]);

/**
 * A second declaration MERGES with the first, so both take effect and the result is the union.
 *
 * `@StableProps` only, and it follows from what the decorator IS: it names a set, and it already merges
 * along the class chain. Nothing is displaced and nothing is wasted — the author asked for the union and
 * got it, spelled twice. Core reports `RMD046`, a warning.
 */
const MERGING = new Set(["StableProps"]);

/**
 * The decorators where a second application changes NOTHING — a different fault, and worth its own
 * sentence, because telling somebody "one of them never runs" here would send them looking for a
 * behaviour difference that does not exist.
 *
 * Measured in core rather than assumed: `@state @state n = 1` renders once per write with the right
 * value, `@compute @compute` runs its body once for two reads, and `@persist` and `@memoized`
 * behave identically doubled. So it is redundancy, which is why it reads as a warning rather than a
 * broken program — the author believed something that is not so, and nothing downstream is wrong.
 *
 * `@watchProp` is deliberately NOT here: several on one method is the supported way for one handler to
 * follow several props, and each application does real work. See `DecoratorReach.test.tsx`, which pins
 * that it runs once per changed prop.
 */
const REDUNDANT_TWICE = new Set(["state", "compute", "persist", "memoized"]);

/**
 * Which declaration is in effect, said per decorator KIND, because the two are opposite.
 *
 * The rule is the same for both — the last one APPLIED stands — but a member decorator initialises
 * top-to-bottom while a class decorator applies bottom-up, so "last applied" is the lowest
 * declaration in one case and the highest in the other. Measured in core's
 * `CatchErrorDecorator.test.tsx` and `PropsGateInheritance.test.tsx`. Naming the wrong one is worse
 * than naming neither: it points at the line that works.
 */
const inEffect = (kind: DuplicateDecoratorIssue["kind"]): string =>
  kind === "member"
    ? "the LOWEST is the one that runs (members initialise top to bottom, so it is applied last)"
    : "the HIGHEST is the one that runs (class decorators apply bottom-up, so it is applied last)";

/**
 * One sentence per EFFECT, because "one of them never runs" is true of `@catchError` and false of
 * the other three.
 *
 * `@Host` throws, so there is no live line to find. `@StableProps` merges, so nothing was lost.
 * A doubled `@state` behaves exactly like a single one — measured, one render per write and the
 * right value. Sending a reader after a difference that is not there is worse than saying less.
 * One report, four faults, four pieces of advice.
 */
const said = (issue: DuplicateDecoratorIssue): string => {
  if (issue.effect === "refuses") {
    return (
      "it THROWS — the class never loads, so there is no live declaration to look for.\n    " +
      "Two answers to what it asks have no union. Keep the one you meant."
    );
  }
  if (issue.effect === "displaces") {
    return `there is one answer to what it asks, so ${inEffect(issue.kind)}\n    and the rest never run. Keep one and combine what they do.`;
  }
  if (issue.effect === "merges") {
    return (
      "they MERGE — both take effect and the result is the union, so nothing is lost.\n    " + "Write them as one call."
    );
  }
  return (
    "applying it twice changes nothing. The behaviour is identical to one, so this is a\n    " +
    "mistaken belief rather than a broken program. Delete the extras."
  );
};

export const duplicateDecorators = {
  id: "duplicate-decorators",

  report: {
    severity: "error",
    reportedWhen:
      "a single-use decorator is written twice: `@Host`, `@catchError`, " +
      "`@ShouldUpdateOnPropsChange` or `@StableProps`",
    // Four codes, one per decorator, because what the framework does about it differs: `@Host`
    // throws, the middle two silently pick a winner, `@StableProps` merges. This rule reports the
    // source of all four, and said so only in prose until the field could hold a list.
    // `RMD050` too, for the member-level half: the same decorator written twice on one member.
    // `decorator-that-adds-nothing` answers the other half of that code — two DIFFERENT decorators
    // giving one member the same thing — and the pair is deliberate.
    alsoReportedAs: ["RMD045", "RMD032", "RMD040", "RMD046", "RMD050"],
    heading: (found) => `${found.length} class(es) declaring a single-use decorator twice:`,
    lines: (issue) => {
      // The member is named for a `redundant` report, because that count is per member: without it,
      // "declares @state 2 times" reads like a claim about the class, which is a different fault.
      const where = issue.member === undefined ? `<${issue.component}>` : `${issue.component}.${issue.member} carries`;
      return [
        `  ${issue.file}:${issue.line}:${issue.column}`,
        `    ${where}${issue.member === undefined ? " declares" : ""} @${issue.decorator} ` +
          `${issue.count} times — ${said(issue)}`,
        "",
      ];
    },
    advice:
      "A SUBCLASS declaring its own is an override, not a duplicate — only declarations on one\n" +
      "class body are counted here.",
  },

  read(cls, { self }) {
    const found: DuplicateDecoratorIssue[] = [];

    /**
     * The two classes of fault are counted at two different LEVELS, and getting that wrong is not a
     * near miss — it is a false positive on ordinary code.
     *
     * A `displacing` decorator answers a question the CLASS asks ("who handles an error from below?"),
     * so two anywhere in the body is the fault. A `redundant` one is about one MEMBER: five fields each
     * carrying `@state` is what every component looks like, and counting `@state` per class reported
     * `<Search> declares @state 5 times` — measured, against this repository's own documentation app,
     * which is how the mistake surfaced.
     */
    const perClass = new Map<string, { count: number; at: ts.Node; kind: "class" | "member" }>();
    const perMember = new Map<string, { count: number; at: ts.Node; member: string }>();

    const count = (node: ts.Node, kind: "class" | "member", member?: string): void => {
      for (const decorator of ts.getDecorators(node as ts.HasDecorators) ?? []) {
        const name = decoratorName(decorator);
        if (name === undefined) continue;

        if (REFUSING.has(name) || DISPLACING.has(name) || MERGING.has(name)) {
          const previous = perClass.get(name);
          if (previous) previous.count += 1;
          else perClass.set(name, { count: 1, at: decorator, kind });
          continue;
        }

        if (REDUNDANT_TWICE.has(name) && member !== undefined) {
          const key = `${member} ${name}`;
          const previous = perMember.get(key);
          if (previous) previous.count += 1;
          else perMember.set(key, { count: 1, at: decorator, member });
        }
      }
    };

    count(cls, "class");
    for (const member of cls.members) count(member, "member", member.name?.getText());

    for (const [decorator, { count: times, at, kind }] of perClass) {
      if (times < 2) continue;
      const effect = REFUSING.has(decorator) ? "refuses" : MERGING.has(decorator) ? "merges" : "displaces";
      found.push({
        component: self.name,
        decorator,
        count: times,
        kind,
        effect,
        ...positionOf(at),
      });
    }

    for (const [key, { count: times, at, member }] of perMember) {
      if (times < 2) continue;
      found.push({
        component: self.name,
        decorator: key.split(" ")[1],
        count: times,
        kind: "member",
        effect: "redundant",
        member,
        ...positionOf(at),
      });
    }

    return found;
  },
} as const satisfies Rule<DuplicateDecoratorIssue>;
