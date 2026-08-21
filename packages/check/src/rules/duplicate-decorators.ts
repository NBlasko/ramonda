import ts from "typescript";
import { coreDecoratorName } from "./core-import";
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
 * What a SECOND application of each single-use decorator does, which is what decides the advice.
 *
 * **One table, and it is checked against core rather than trusted.** These are facts about the
 * framework's runtime, written here because this package never imports it — so the two could disagree
 * and nothing would notice: change core so a second `@StableProps` throws and this would keep telling
 * people it merges. `scripts/check-decorator-duplication.mjs` compares this against the `duplicate`
 * field on core's diagnostics and fails the build if they differ, in either direction — including a
 * decorator core learns about and this table does not, where the rule simply says nothing.
 *
 * It was four `Set`s until then, one per effect, and the effect was recovered by asking each in turn.
 * A single map says the same thing once and is directly comparable to core's.
 *
 * The four words are the four pieces of advice, and telling them apart is the point:
 * - `refuses` — it THROWS (`@Host`, RMD045). Two element names have no union, so the class never
 *   loads and there is no live line to hunt for.
 * - `displaces` — one wins and the rest are dead code (`@catchError` RMD032,
 *   `@ShouldUpdateOnPropsChange` RMD040). The reader needs to know WHICH is live.
 * - `merges` — both take effect and the result is the union (`@StableProps`, RMD046). It names a set
 *   and already merges along the class chain, so nothing is lost; the spelling is redundant.
 * - `redundant` — the second changes nothing at all (`@state`, `@compute`, `@persist`, `@memoized`,
 *   RMD050). Measured in core rather than assumed: `@state @state n = 1` still renders the right
 *   value, `@compute @compute` runs its body once for two reads.
 *
 * `@watchProp` is deliberately absent: several on one method is the supported way for one handler to
 * follow several props, and each application does real work. See core's `DecoratorReach.test.tsx`.
 */
const EFFECT: Record<string, DuplicateDecoratorIssue["effect"]> = {
  Host: "refuses",
  catchError: "displaces",
  ShouldUpdateOnPropsChange: "displaces",
  StableProps: "merges",
  state: "redundant",
  compute: "redundant",
  persist: "redundant",
  memoized: "redundant",
};

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

  read(cls, { self, resolve }) {
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
        // Core's decorators only, by the name core exports: an app's own decorator written twice
        // is the app's business, and one of core's under an alias is still core's.
        const name = coreDecoratorName(decorator, resolve);
        if (name === undefined) continue;

        /**
         * `Object.hasOwn` before the read, because this is an object literal and the four `Set`s it
         * replaced could not be answered by `Object.prototype`.
         *
         * **Not reachable today, and measured rather than assumed both ways.** `coreName` returns only
         * a name `@ramonda/core` exports, and none of its 101 exports shares a name with an
         * `Object.prototype` member — so `EFFECT["toString"]` cannot be asked. It WAS reachable in the
         * commit that introduced this table, before the merge brought `coreDecoratorName`: the old
         * `decoratorName` handed over the text somebody wrote, so `@toString @toString` returned a
         * FUNCTION, passed an `undefined` check, and landed in a report's `effect` field.
         *
         * Kept because what feeds this is a name from somebody else's source, and the guard costs one
         * comparison to make that safe whatever resolves it next.
         */
        if (!Object.hasOwn(EFFECT, name)) continue;
        const effect = EFFECT[name];
        if (effect === undefined) continue;

        if (effect !== "redundant") {
          const previous = perClass.get(name);
          if (previous) previous.count += 1;
          else perClass.set(name, { count: 1, at: decorator, kind });
          continue;
        }

        if (member !== undefined) {
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
      // Non-null: `perClass` is only written for a name the table has, three lines above.
      const effect = EFFECT[decorator] as DuplicateDecoratorIssue["effect"];
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
