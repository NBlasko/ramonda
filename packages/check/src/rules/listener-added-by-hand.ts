import ts from "typescript";
import { memberName, positionOf } from "../syntax";
import { follow, type Looking } from "./follow-value";
import { insideADevGuard } from "./dev-guard";
import { isTheGlobal } from "./globals";
import { heritage } from "./render-reach";
import type { Rule, RuleContext } from "./rule";

/**
 * A component reaching for `window.addEventListener` itself, where a decorator does it.
 *
 * `@onWindow` and `@onDocument` attach on mount and detach on unmount, and there is nothing to
 * remember. A hand-rolled listener has to be removed by hand, and one that is not outlives the
 * component that added it: nothing about unmounting touches it, so the handler keeps running,
 * reading state nobody is showing and holding the component and everything it closed over alive.
 * Open and close the same view ten times and there are ten of them, all still listening.
 *
 * So the plain answer is the decorator, and this says so wherever the decorator would have worked.
 *
 * ## The one thing the decorator cannot do, said out loud rather than papered over
 *
 * A listener the app ARMS — on a click, after a fetch — cannot be written with `@onWindow`, which
 * attaches for the owner's whole life. There is no hook for it yet, and the rule still reports the
 * raw call, so the advice has to say what the reader is actually left with rather than pretend the
 * decorator covers it. `Interval` and `Timeout` are the same problem already solved for timers:
 * hooks the app starts and stops, which the framework still clears when the owner goes.
 *
 * ## The one place a decorator genuinely cannot be used: `if (__DEV__)`
 *
 * A decorator is code on the CLASS. No `__DEV__` guard can remove it, so a dev-only listener
 * written with `@onWindow` would attach in production too — on every mount, for an event nothing
 * dispatches, calling a method whose body compiled away. Measured in
 * `packages/query/dist/index.prod.js`: today those methods are `publishToDevtools(){}` and the
 * listener does not exist, while `@onWindow("online")` on the `Query` hook is plainly there in the
 * same file.
 *
 * `@ramonda/query` and `@ramonda/form` both need exactly this, and both already say so in their own
 * source. So inside a dev guard the hand-rolled call is the RIGHT answer, and the only question
 * left is the ordinary one: does anything remove it.
 *
 * **A guard is a fact and an annotation is a promise**, which is why the escape is the guard.
 * `// ramonda-check-ignore` is the author's claim about a line and can be sprinkled anywhere; a
 * `__DEV__` block can only be got by making the code really vanish from the build. See
 * {@link insideADevGuard}.
 *
 * ## Two options really do clean up, and both are silent everywhere
 *
 * `{ once: true }` removes the listener after it fires, and `{ signal }` removes it when the signal
 * aborts. Reporting either would be reporting the fix.
 *
 * ## A listener added in a render is one per PASS
 *
 * Measured against the real runtime: `window.addEventListener("resize", …)` written in a `render()`
 * registered **6 listeners over 6 renders**, none of them removed. The report says which member it
 * is in for that reason — the same line in `@created` leaks once per mount, and in a render once
 * per render, and those are not the same sentence.
 *
 * ## What it is deliberately silent about
 *
 * **Anything that is not `window` or `document`.** `signal.addEventListener("abort", …)` on an
 * `AbortSignal` dies with the request; a listener on an element from a ref dies with the element.
 * Neither outlives anything, and no decorator covers either.
 *
 * **Module scope**, which is not a class member and lives as long as the module does.
 *
 * **A name this cannot read**, inside a dev guard. `window.addEventListener(kind, …)` where `kind`
 * is a field is an event this cannot match against a removal — so it cannot say whether the hatch
 * is closed. Outside a guard the event name does not matter: the decorator was the answer whatever
 * it is called.
 *
 * ## The chain is walked upward, and that decides one silence
 *
 * A base's `@destroyed` removing a listener answers one its subclass added, on the same instance.
 * Downward there is nothing to read — a class does not know who extends it — so an ABSTRACT class
 * adding a listener goes unreported: it is never mounted on its own, and any subclass may be the
 * one that removes it. The same reasoning `interval-with-no-cleanup` is built on.
 */
export interface ListenerAddedByHandIssue {
  /** The component or hook. */
  component: string;
  /** `window` or `document`, as it was written. */
  on: string;
  /** The event listened for — `resize`, `keydown`; `undefined` when the name cannot be read. */
  event: string | undefined;
  /**
   * Why it is reported, because the two have different fixes.
   *
   * `a decorator does it` — the ordinary case, and the fix is one line. `nothing removes it` is
   * what is left inside `if (__DEV__)`, where the hand-rolled call is right and the hatch is open.
   */
  why: "a decorator does it" | "nothing removes it";
  /** The member it is added in. */
  member: string;
  /** Whether that member is a render, where it happens once per PASS rather than once per mount. */
  perRender: boolean;
  file: string;
  line: number;
  column: number;
}

/** The event name, through a `const` — `addEventListener(RESIZE, …)` is the same event. */
const EVENT: Looking<string> = {
  leaf: (expression) => (ts.isStringLiteralLike(expression) ? expression.text : undefined),
  throughModuleScope: true,
  throughBranches: false,
  throughCalls: false,
  throughMutableBindings: false,
};

/**
 * The global object, when that is what this names — `globals.ts` decides, so all three rules that
 * ask agree. Requiring `globalThis` to resolve to nothing silenced every listener written on it.
 */
function globalNamed(node: ts.Expression, resolve: RuleContext["resolve"]): string | undefined {
  return isTheGlobal(node, resolve) && ts.isIdentifier(node) ? node.text : undefined;
}

/**
 * WHICH object a name names, rather than how it was spelled.
 *
 * `window`, `globalThis` and `self` are one object; `document` is another. Matching an add against
 * a removal by the SPELLING made a listener added on `window` and removed on `globalThis` look
 * uncleaned — which is the `@ramonda/query` and `@ramonda/form` devtools shape with one word
 * changed, and it was reported. The written name is still what the report prints, because that is
 * what the reader has on the line.
 */
function objectNamed(written: string): "document" | "the global" {
  return written === "document" ? "document" : "the global";
}

/** An `addEventListener` or `removeEventListener` on one of those globals, and what it listens for. */
function listenerCall(
  node: ts.Node,
  which: "addEventListener" | "removeEventListener",
  resolve: RuleContext["resolve"],
): { on: string; event: string | undefined; call: ts.CallExpression } | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (node.expression.name.text !== which) return undefined;

  const on = globalNamed(node.expression.expression, resolve);
  if (on === undefined) return undefined;

  // The event name may be unreadable and the call is still a call: outside a dev guard the
  // decorator is the answer whatever it is called, and only the matching below needs the name.
  const named = node.arguments[0];
  return { on, event: named === undefined ? undefined : follow(named, resolve, EVENT)?.value, call: node };
}

/**
 * Whether the third argument closes the hatch on its own.
 *
 * `{ once: true }` removes the listener after it fires; `{ signal }` removes it when the signal
 * aborts. Both are the fix, so both are silent — and anything else written there is an options
 * object this cannot read, which is silent for the reason everything unreadable is.
 */
function cleansUpItself(call: ts.CallExpression): boolean {
  const options = call.arguments[2];
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return false;

  for (const property of options.properties) {
    const key =
      property.name !== undefined && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ? property.name.text
        : undefined;
    if (key === "signal") return true;
    if (key !== "once") continue;
    // `{ once: false }` is the default written out, and closes nothing.
    if (ts.isShorthandPropertyAssignment(property)) return true;
    if (ts.isPropertyAssignment(property) && property.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
  }
  return false;
}

export const listenerAddedByHand = {
  id: "listener-added-by-hand",

  report: {
    severity: "warn",
    reportedWhen:
      "a component adds a `window` or `document` listener by hand, where `@onWindow` or `@onDocument` would do it — " +
      "or, inside `if (__DEV__)` where a decorator cannot be used, adds one that nothing ever removes",
    heading: (found) => `${found.length} listener(s) added by hand:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.why === "a decorator does it"
        ? `    <${issue.component}>'s \`${issue.member}\` calls ${issue.on}.addEventListener(${
            issue.event === undefined ? "" : `"${issue.event}"`
          }) — @${issue.on === "document" ? "onDocument" : "onWindow"} attaches and detaches it for you${
            issue.perRender ? ", and this is a render, so it happens again on every pass." : "."
          }`
        : `    <${issue.component}>'s \`${issue.member}\` listens for \`${issue.event}\` on ${issue.on} inside a ` +
          `\`__DEV__\` guard, and no \`removeEventListener\` names it${
            issue.perRender
              ? " — and this is a render, so it happens again on every pass."
              : " — it keeps firing after the component is gone."
          }`,
    ],
    advice:
      "`@onWindow` and `@onDocument` attach on mount and detach on unmount, and there is nothing to\n" +
      "remember:\n\n" +
      '  @onWindow("resize")\n' +
      "  onResize() { … }\n\n" +
      "A hand-rolled listener has to be removed by hand, and one that is not outlives the component\n" +
      "that added it: the handler keeps running, reading state nobody is showing and holding the\n" +
      "component and everything it closed over alive. Open and close the same view ten times and\n" +
      "there are ten of them.\n\n" +
      "In a `render()` it is worse than it looks — a render runs whenever the framework likes, so\n" +
      "the listener is registered again on every pass.\n\n" +
      "**A listener the app ARMS — on a click, after a fetch — has no hook yet, and that is a gap in\n" +
      "the framework rather than something to work around here.** `@onWindow` attaches for the\n" +
      "owner's whole life and cannot be turned on and off. The shape the answer will take is already\n" +
      "in the framework for timers: `Interval` and `Timeout` are hooks the app starts and stops while\n" +
      "the framework still clears them when the owner goes. Until the same exists for a listener,\n" +
      "this reports the raw call and the honest fix is to keep the listener for the owner's lifetime\n" +
      "and decide INSIDE the handler whether to act.\n\n" +
      "**Inside `if (__DEV__)` the hand-rolled call is right**, and this asks only that it be cleaned\n" +
      "up. A decorator is code on the class, so no guard can remove it and a dev-only listener\n" +
      "written with `@onWindow` would attach in production too. Keep the raw call there and pair it\n" +
      "with a `removeEventListener` for the same event in `@destroyed`, with the same handler\n" +
      "reference. `{ once: true }` and `{ signal }` close it as well, and neither is reported.\n\n" +
      "A listener on anything else is not this rule's business: an `AbortSignal` dies with its\n" +
      "request and an element with the element, and no decorator covers either.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self, resolve }) {
    // The BASES too, for the REMOVALS: a shared base's `@destroyed` removing a listener answers one
    // its subclass added, on the same instance — the same argument `interval-with-no-cleanup` makes.
    const declared = [cls, ...heritage(cls, resolve)];

    /** Every event some `removeEventListener` in the chain names, by the OBJECT rather than the name. */
    const removed = new Set<string>();
    /**
     * Objects something removes a listener from under a name this cannot read.
     *
     * `window.removeEventListener(this.kind, h)` is a removal, and which event it takes away is not
     * knowable — so the add beside it cannot be called uncleaned. The add side already goes quiet on
     * an unreadable name; the remove side has to be at least as careful, or the caution on one is
     * undone by the carelessness of the other.
     */
    const removesSomethingUnreadable = new Set<string>();

    for (const declaring of declared) {
      for (const member of declaring.members) {
        ts.forEachChild(member, function look(node) {
          const call = listenerCall(node, "removeEventListener", resolve);
          if (call !== undefined) {
            if (call.event === undefined) removesSomethingUnreadable.add(objectNamed(call.on));
            else removed.add(`${objectNamed(call.on)}:${call.event}`);
          }
          ts.forEachChild(node, look);
        });
      }
    }

    /**
     * An abstract class is never mounted on its own, so a subclass may be the one that removes its
     * listener — and this cannot see downward. That excuses the CLEANUP question only. Whether a
     * decorator would have done the job does not depend on who extends the class.
     */
    const abstract = cls.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword) === true;

    const found: ListenerAddedByHandIssue[] = [];

    for (const member of cls.members) {
      // A member with no plain name is still walked — the fault is the listener, not where it sits.
      const inMember = memberName(member) ?? "the class body";
      const perRender = inMember === "render";

      ts.forEachChild(member, function look(node) {
        const added = listenerCall(node, "addEventListener", resolve);
        if (added !== undefined) {
          const where = { component: self.name, on: added.on, member: inMember, perRender, ...positionOf(node) };

          if (!insideADevGuard(node)) {
            /**
             * The decorator was the answer, whatever the event is called and whether or not the
             * listener is removed — so neither an unreadable name nor a matching removal changes
             * anything here. `{ once: true }` does not either: `@onWindow` takes the same options.
             */
            found.push({ ...where, event: added.event, why: "a decorator does it" });
          } else if (
            !abstract &&
            !cleansUpItself(added.call) &&
            added.event !== undefined &&
            !removed.has(`${objectNamed(added.on)}:${added.event}`) &&
            !removesSomethingUnreadable.has(objectNamed(added.on))
          ) {
            // Inside a dev guard the hand-rolled call is right, and the only question left is
            // whether the hatch is closed.
            found.push({ ...where, event: added.event, why: "nothing removes it" });
          }
        }
        ts.forEachChild(node, look);
      });
    }

    return found;
  },
} as const satisfies Rule<ListenerAddedByHandIssue>;
