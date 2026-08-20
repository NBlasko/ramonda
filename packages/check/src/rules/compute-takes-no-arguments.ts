import ts from "typescript";
import { memberName, positionOf } from "../syntax";
import { hasDecorator } from "./render-reach";
import type { Rule } from "./rule";

/**
 * A `@compute` that declares a parameter.
 *
 * A `@compute` caches ONE value per component. There is no key, so there is nowhere for an argument to
 * go: it is accepted and ignored, and the second call with a different argument hands back the first
 * call's answer. Nothing throws in a bundle that has been built, nothing is logged, and the number on the
 * page is simply wrong.
 *
 * ## Why a rule when the runtime refuses it
 *
 * Because the runtime refuses it when the class DEFINITION runs, which is when the module is first
 * imported — so a component behind a route nobody opened, or a lazily-loaded chunk, ships with the fault
 * and throws in front of whoever gets there first. This reports it before it is built, which is the whole
 * axis this package sits on.
 *
 * **The type refuses it first**, and this rule is the second net rather than the only one. Measured:
 * `@compute withArg(k: number)` is `TS1241` — a function declaring a parameter is not assignable to one
 * that declares none, so `compute`'s own `(this: T) => R` is the earliest check there is. What is left for
 * a rule is a project with no types, a `@ts-ignore`, or a cast — the same role `attribute-that-does-nothing`
 * plays beside the JSX types.
 *
 * ## What to write instead
 *
 * `@memoized`, which is the decorator keyed BY its arguments — one cached value per argument, per
 * instance. That is the whole difference between the two, and `unkeyable-memoized-argument` is the rule
 * that watches the other side of it.
 *
 * ## The chain is NOT walked, and that is the correct answer here
 *
 * A fault in a base is reported when the base is analysed, because every class in the program is. Walking
 * upward as well would report a base's parameter again for every class extending it — the shape three
 * rules in this package have already had to be fixed for. This asks only about the members the class in
 * front of it DECLARES.
 */
export interface ComputeTakesNoArgumentsIssue {
  /** The class the compute is declared on. */
  component: string;
  /** The compute, as the reader would find it. */
  member: string;
  /** The first parameter's name, which is what to delete. */
  parameter: string;
  /** How many it declares, because more than one says the writer meant to call it. */
  count: number;
  file: string;
  line: number;
  column: number;
}

export const computeTakesNoArguments = {
  id: "compute-takes-no-arguments",

  report: {
    /**
     * An ERROR, and not the usual warning-first.
     *
     * The value is WRONG rather than slow: an ignored argument means one call's answer is served to
     * another's. The runtime refuses it in every build for the same reason, so a warning here would be
     * this package disagreeing with the framework about how bad it is.
     */
    severity: "error",
    reportedWhen: "a `@compute` declares a parameter, and its cache is keyed by nothing so the argument is ignored",
    heading: (found) => `${found.length} \`@compute\` declaration(s) that take an argument:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>.${issue.member} declares ${issue.count} parameter(s), starting with`,
      `    \`${issue.parameter}\` — a \`@compute\` caches one value per component, so nothing passes it`,
      `    and the second call with a different argument gets the first call's answer.`,
    ],
    advice:
      "A `@compute` has no key: one value per component, recomputed when something it READ changes. So an\n" +
      "argument has nowhere to go — it is accepted and ignored.\n\n" +
      "When the value differs per argument, `@memoized` is the decorator keyed by them:\n\n" +
      "    @memoized rowConfig(id: string) { return { id, href: `/rows/${id}` } }\n\n" +
      "One cached value per argument, per instance, dropped when a render stops asking for it. See\n" +
      "/concepts/caching for the whole comparison.\n\n" +
      "The framework refuses this too, when the class definition runs — which is when the module is first\n" +
      "imported. A component behind a route nobody opened would ship with it and throw for whoever opens\n" +
      "that route, which is why it is reported here as well.",
  },

  read(cls, { self }) {
    const found: ComputeTakesNoArgumentsIssue[] = [];

    // Written where it is DECLARED, once — see the note on the chain above.
    for (const member of cls.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      if (!hasDecorator(member, "compute")) continue;
      if (member.parameters.length === 0) continue;

      const name = memberName(member);
      const first = member.parameters[0];
      if (name === undefined || first === undefined) continue;

      found.push({
        component: self.name,
        member: name,
        parameter: first.name.getText(),
        count: member.parameters.length,
        ...positionOf(first),
      });
    }

    return found;
  },
} as const satisfies Rule<ComputeTakesNoArgumentsIssue>;
