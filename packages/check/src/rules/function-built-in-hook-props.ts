import ts from "typescript";
import { hookNamed, isThisUse, positionOf } from "../syntax";
import { builtFunctionIn, shorten } from "./follow-value";
import { bagOf, reactiveReadIn } from "./fresh-object-in-hook-props";
import type { Rule } from "./rule";

/**
 * A function built inside a hook's props callback — `fetch: () => self.load()`.
 *
 * `function-built-in-the-markup` is the same fault where a parent writes it in JSX. This is where a
 * component writes it for a hook, and the runtime reports it as RMD022: every prop is a signal, so a
 * new function is a CHANGED prop — a `@watchProp` on it fires, a subscription whose `connect` reads it
 * reconnects. Found by measuring the runtime against the checker, one shape at a time: nothing in the
 * checker looked at a function in a props bag.
 *
 * ## When it fires
 *
 * The same two conditions `fresh-object-in-hook-props` has, read by the same code: a function built
 * in the bag, and a REACTIVE read in the callback that can make it run again. A callback that reads
 * no signal is called once, at mount, and its function keeps one identity — that is correct.
 *
 * ## What is not an exception here
 *
 * **`@StableProps`.** Two closures with the same body are not equal by any comparison that is safe
 * to make, so declaring the prop a value cannot settle a function — RMD022 says so too. Which is also
 * why a hook reached through a `.d.ts` is reported: there is no declaration to be unable to see.
 *
 * The answer is a method: `fetch: self.load` reads `this` when it is called, so there is nothing to
 * capture and the identity never changes; `@memoized` when it has to be built per argument.
 */
export interface FunctionBuiltInHookPropsIssue {
  /** The class writing the `use`. */
  component: string;
  /** The hook, as written. */
  hook: string;
  /** The prop's name. */
  prop: string;
  /** How it is written, so the report quotes the line. */
  written: string;
  /** What makes the callback run again. */
  rebuiltBecauseOf: string;
  file: string;
  line: number;
  column: number;
}

export const functionBuiltInHookProps = {
  id: "function-built-in-hook-props",

  report: {
    severity: "error",
    reportedWhen:
      "a hook is handed a function built inside its props callback, where the callback also reads something reactive, so the prop is a new function every time it runs",
    alsoReportedAs: "RMD022",
    heading: (found) => `${found.length} function(s) rebuilt in a hook's props:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> gives ${issue.hook} a new function for \`${issue.prop}\` — \`${issue.written}\` — every time ${issue.rebuiltBecauseOf} changes.`,
    ],
    advice:
      "A hook's props are signals, so a new function is a CHANGED prop: whatever watches it runs again,\n" +
      "with nothing changed. Hand over a method instead — `fetch: self.load` — which reads `this` when\n" +
      "it is called, so there is nothing to capture and its identity never changes. For one built per\n" +
      "argument, `@memoized`. Declaring the prop with `@StableProps` cannot help: two functions are\n" +
      "never equal by content.\n\n",
  },

  read(cls, { self, resolve }) {
    const found: FunctionBuiltInHookPropsIssue[] = [];

    for (const member of cls.members) {
      if (!ts.isPropertyDeclaration(member)) continue;
      const call = member.initializer;
      if (call === undefined || !ts.isCallExpression(call) || !isThisUse(call)) continue;
      if (call.arguments.length < 2) continue;

      const bag = bagOf(call.arguments[1]);
      if (bag === undefined) continue;
      // Everything up to the last spread may be overwritten by it, as in JSX.
      const lastSpread = bag.properties.reduce(
        (at, property, index) => (ts.isSpreadAssignment(property) ? index : at),
        -1,
      );

      let rebuiltBecauseOf: string | undefined;
      for (const [index, property] of bag.properties.entries()) {
        if (index < lastSpread) continue;
        const name = property.name;
        if (name === undefined || !ts.isIdentifier(name)) continue;

        // A method written in the bag — `fetch() { … }` — is a function built there too.
        const built = ts.isMethodDeclaration(property)
          ? true
          : ts.isPropertyAssignment(property) && builtFunctionIn(property.initializer, resolve, 0) !== undefined;
        if (!built) continue;

        // Asked once per `use`, and only once a function has been found.
        rebuiltBecauseOf ??= reactiveReadIn(call.arguments[1], cls, resolve) ?? "";
        if (rebuiltBecauseOf === "") break;

        found.push({
          component: self.name,
          hook: hookNamed(call.arguments[0]).getText(),
          prop: name.text,
          written: ts.isPropertyAssignment(property) ? shorten(property.initializer) : `${name.text}() { … }`,
          rebuiltBecauseOf,
          ...positionOf(property),
        });
      }
    }

    return found;
  },
} as const satisfies Rule<FunctionBuiltInHookPropsIssue>;
