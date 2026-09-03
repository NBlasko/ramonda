import ts from "typescript";
import { memberName, positionOf } from "../syntax";
import { heritage } from "./render-reach";
import type { Rule, RuleContext } from "./rule";

/**
 * A raw `setInterval` a component never clears, so it keeps firing after the component is gone.
 *
 * An interval does not stop by itself. Nothing about unmounting a component touches one, so the
 * callback keeps running on a schedule — reading state nobody is showing, holding the component and
 * everything it closed over alive, and doing it once a second for as long as the page is open. Open
 * and close the same view ten times and there are ten of them.
 *
 * `@interval` exists for this: it starts on mount and clears itself on unmount. A raw timer is
 * allowed, and then the id has to live on a class property so `@destroyed` can reach it — a returned
 * closure cannot, which is exactly why the framework's own advice says a property.
 *
 * ## `setInterval` only, and `setTimeout` deliberately not
 *
 * A timeout stops on its own. An uncleared `setTimeout(fn, 0)` is written constantly and leaks
 * nothing in any run that matters, so a rule reporting it would be reporting the commonest correct
 * line of asynchronous code there is. A long one CAN outlive a component — and telling a long one
 * from a short one is a judgement about a number, which is exactly the kind of maybe this package
 * does not report. `RMD006` at runtime catches those, because it looks at what is still armed.
 *
 * An interval needs no judgement: uncleared, it is certain.
 *
 * ## The three shapes, and why each is certain rather than likely
 *
 * - **The id is discarded.** `setInterval(…)` as a statement. There is no id anywhere, so nothing
 *   can ever clear it.
 * - **The id goes into a local.** A local dies with the call that made it, so unless the same
 *   function clears it, nothing can reach it afterwards — `@destroyed` least of all.
 * - **The id goes onto `this`, and no `clearInterval` in the class OR ITS BASES ever names that
 *   property.** This is the documented shape done half way, which is the one worth catching:
 *   somebody followed the advice as far as the property and stopped.
 *
 * ## The chain is walked upward, and that decides one silence
 *
 * A base's members are the component's members, so a `@destroyed` on a shared base clearing
 * `this.id` answers an interval its subclass started. Reading one class alone missed that.
 *
 * Downward there is nothing to read: a class does not know who extends it. So an ABSTRACT class
 * keeping an id on a property goes unreported — it is never mounted on its own, and any subclass
 * may be the one that clears it. A concrete class keeps its report, because `<Base />` on its own
 * really does leak. An id kept nowhere or in a local is certain either way: no subclass can reach it.
 */
export interface IntervalWithNoCleanupIssue {
  /** The component or hook. */
  component: string;
  /** The member the interval is started in. */
  member: string;
  /** Where the id went, which decides what the advice should say. */
  kept: "nowhere" | "a local" | "a property";
  /** The property or local it was kept in, when there was one. */
  named: string | undefined;
  file: string;
  line: number;
  column: number;
}

/** Whether a call is the global `setInterval`, however it is spelled. */
function isSetInterval(call: ts.CallExpression, resolve: RuleContext["resolve"]): boolean {
  const callee = call.expression;
  // `window.setInterval(…)` / `globalThis.setInterval(…)`
  if (ts.isPropertyAccessExpression(callee)) {
    return (
      callee.name.text === "setInterval" &&
      ts.isIdentifier(callee.expression) &&
      ["window", "globalThis", "self"].includes(callee.expression.text)
    );
  }
  // A bare `setInterval` that resolves to NOTHING is the platform's — the same question
  // `browser-url` asks about `location`, and it costs no type: the program is built with no lib, so
  // a name the browser owns has no declaration and one the app wrote does.
  return ts.isIdentifier(callee) && callee.text === "setInterval" && resolve(callee) === undefined;
}

/**
 * What this class clears an interval with — properties and locals kept apart.
 *
 * ONE set would let a local called `tick` silence a property called `tick`, which is a miss nobody
 * would ever find. It only errs towards silence, so it is not a false report — but a muddled set is
 * the kind of thing a later reader has to re-derive, and keeping them apart costs one line.
 */
function clearedNames(classes: readonly ts.ClassLikeDeclaration[]): {
  properties: ReadonlySet<string>;
  locals: ReadonlySet<string>;
} {
  const properties = new Set<string>();
  const locals = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : "";
      // Either clear counts: an id is an id, and somebody clearing an interval with `clearTimeout`
      // has written something odd that nonetheless works.
      if (name === "clearInterval" || name === "clearTimeout") {
        for (const argument of node.arguments) {
          if (
            ts.isPropertyAccessExpression(argument) &&
            argument.expression.kind === ts.SyntaxKind.ThisKeyword &&
            ts.isIdentifier(argument.name)
          ) {
            properties.add(argument.name.text);
          }
          // A local cleared somewhere — enough to tell `const id = setInterval(…); clearInterval(id)`
          // from one that is never cleared.
          if (ts.isIdentifier(argument)) locals.add(argument.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  for (const declaring of classes) for (const member of declaring.members) ts.forEachChild(member, visit);
  return { properties, locals };
}

/**
 * The property a local is handed on to, when the same body does that — `this.tick = id`.
 *
 * A FALSE REPORT before it was planted. `const id = setInterval(…); this.tick = id` was read as an
 * id kept in a local that dies with the call, on a component whose `@destroyed` clears `this.tick`,
 * and the report said nothing could ever reach it. The id escapes the local the moment it is
 * assigned to a property, and where it lands is what decides whether anything clears it.
 *
 * Only within the member that made the local: the local's own scope is the furthest it can be read
 * from, and this rule is about a value that has to be reachable LATER.
 */
function handedToAProperty(local: string, within: ts.Node): string | undefined {
  let named: string | undefined;

  (function look(node: ts.Node): void {
    if (named !== undefined) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.right) &&
      node.right.text === local &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
      ts.isIdentifier(node.left.name)
    ) {
      named = node.left.name.text;
      return;
    }
    ts.forEachChild(node, look);
  })(within);

  return named;
}

/** Where the id of this call goes, read from what encloses it. */
function keptIn(call: ts.CallExpression): { kept: IntervalWithNoCleanupIssue["kept"]; named: string | undefined } {
  const parent = call.parent;

  // `this.tick = setInterval(…)`
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const target = parent.left;
    if (
      ts.isPropertyAccessExpression(target) &&
      target.expression.kind === ts.SyntaxKind.ThisKeyword &&
      ts.isIdentifier(target.name)
    ) {
      return { kept: "a property", named: target.name.text };
    }
    if (ts.isIdentifier(target)) return { kept: "a local", named: target.text };
  }

  // `const id = setInterval(…)`, and `tick = setInterval(…)` as a field initializer.
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return { kept: "a local", named: parent.name.text };
  }
  if (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return { kept: "a property", named: parent.name.text };
  }

  return { kept: "nowhere", named: undefined };
}

export const intervalWithNoCleanup = {
  id: "interval-with-no-cleanup",

  report: {
    severity: "error",
    reportedWhen:
      "a component starts a raw `setInterval` whose id nothing ever clears, so it keeps firing after unmount",
    alsoReportedAs: ["RMD006"],
    heading: (found) => `${found.length} interval(s) nothing clears:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>'s \`${issue.member}\` starts an interval and keeps its id ${
        issue.kept === "nowhere"
          ? "nowhere"
          : issue.kept === "a local"
            ? `in a local (\`${issue.named}\`), which dies with the call`
            : `on \`this.${issue.named}\`, which no \`clearInterval\` ever names`
      } — it keeps firing after the component is gone.`,
    ],
    advice:
      "An interval does not stop by itself, and nothing about unmounting a component touches one. So\n" +
      "the callback keeps running on a schedule, reading state nobody is showing and holding the\n" +
      "component and everything it closed over alive. Open and close the same view ten times and\n" +
      "there are ten of them.\n\n" +
      "`@interval(1000) tick() { … }` starts on mount and clears itself on unmount, which is what it\n" +
      "is for. For an interval the APP starts — on a click, after a fetch — the `Interval` hook does\n" +
      "the same for one it does not own the start of:\n\n" +
      "  private ticker = this.use(Interval, () => ({ run: this.refresh }));\n" +
      "  begin() { this.ticker.start(1000); }\n" +
      "  halt() { this.ticker.stop(); }\n\n" +
      "A raw timer is still allowed, and then the id has to live on a class property so\n" +
      "`@destroyed` can reach it:\n\n" +
      "  @destroyed stop() { clearInterval(this.tick); }\n\n" +
      "A returned closure cannot do this — nothing calls it — which is why the fallback is a property\n" +
      "rather than a cleanup function.\n\n" +
      "`setTimeout` is NOT reported: it stops on its own, and telling a long one from a short one is\n" +
      "a judgement about a number. The framework catches those at runtime, where it can see what is\n" +
      "still armed.\n\n",
  },

  read(cls, { self, resolve }) {
    // The BASES too: a shared base's `@destroyed stop() { clearInterval(this.id) }` clears an
    // interval its subclass started, on the same instance. Reading one class alone reported it.
    const cleared = clearedNames([cls, ...heritage(cls, resolve)]);
    const abstract = cls.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword) === true;
    const found: IntervalWithNoCleanupIssue[] = [];

    for (const member of cls.members) {
      // A member with no plain name is still walked — the fault is the uncleared interval.
      const inMember = memberName(member) ?? "the class body";

      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && isSetInterval(node, resolve)) {
          let { kept, named } = keptIn(node);
          // The id may pass THROUGH a local on its way to a property, and where it lands is what
          // decides whether anything can clear it.
          if (kept === "a local" && named !== undefined) {
            const onwards = handedToAProperty(named, member);
            if (onwards !== undefined) {
              kept = "a property";
              named = onwards;
            }
          }
          // A name something clears is the shape the advice asks for, wherever it is cleared from —
          // and a property is only answered by a property, a local only by a local.
          const isCleared =
            named !== undefined && (kept === "a property" ? cleared.properties.has(named) : cleared.locals.has(named));
          /**
           * An ABSTRACT class keeping the id on a property is the one shape this cannot answer. The
           * chain is walked upward, never down, so a subclass clearing the property is invisible —
           * and an abstract class is never mounted on its own, which makes the report a guess rather
           * than a fact. A concrete base IS mountable, so it keeps its report.
           *
           * Only the property shape: an id kept nowhere, or in a local that dies with the call, is
           * beyond any subclass's reach and stays certain either way.
           */
          const aSubclassMightClearIt = abstract && kept === "a property";
          if (!isCleared && !aSubclassMightClearIt) {
            found.push({ component: self.name, member: inMember, kept, named, ...positionOf(node) });
          }
        }
        ts.forEachChild(node, visit);
      };

      ts.forEachChild(member, visit);
    }

    return found;
  },
} as const satisfies Rule<IntervalWithNoCleanupIssue>;
