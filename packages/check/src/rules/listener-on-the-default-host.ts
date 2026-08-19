import ts from "typescript";
import { positionOf } from "../syntax";
import type { Rule } from "./rule";

/**
 * `@onElement` on a component that has no `@Host`, so the listener sits on a box that is not there.
 *
 * Without `@Host` a component's host element is `<ramonda-host style="display: contents">`. That is
 * the whole point of the default: it takes part in no layout, so the markup inside it lands in the
 * parent's grid or flex row exactly as if the component were not there.
 *
 * The cost is that it has no BOX. An element with `display: contents` generates no box, so nothing
 * can be over it and nothing can enter it.
 *
 * ## Only a NON-BUBBLING event, and that narrowing came from being asked
 *
 * The first version reported every `@onElement` on a default host, which is what the runtime did
 * too. Measured after the question was put: a click on a CHILD of a boxless host reaches the
 * listener perfectly well — the handler ran, the count went up. Bubbling does not need a box; it
 * needs an ancestor, and the host is one.
 *
 * So a bubbling listener there is not a fault and reporting it was reporting working code, which is
 * the one thing this package refuses to do. What genuinely never arrives is an event dispatched at
 * its target and nowhere else: `mouseenter` needs a box to enter, `focus` needs something
 * focusable. Those are reported, and `RMD042` was narrowed to match.
 *
 * The framework reports it as `RMD042` when the listener is attached, which is on mount and on the
 * client. This says it before the page is opened, including for a component behind a route nobody
 * clicked.
 *
 * ## What makes it provable
 *
 * Both halves are decorators, so it is syntax: `@onElement` on a member, and no `@Host` on the
 * class or on anything it extends. `@Host` is inherited — the tag is read from the constructor — so
 * the heritage is walked, and a component extending a `@Host`-ed base has a real element.
 *
 * A `@Host` whose tag is a CALLBACK makes this go quiet: what it returns is decided at runtime and
 * may be nothing at all, and reporting a component whose author clearly thought about its host
 * would be reporting the wrong thing.
 */
export interface ListenerOnTheDefaultHostIssue {
  /** The component. */
  component: string;
  /** The member carrying the listener. */
  member: string;
  /** The event it waits for, which is what decides whether anything arrives at all. */
  event: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Events that do not bubble, so on a boxless host the handler never runs at all.
 *
 * The list is the DOM's rather than a judgement: each of these is dispatched at its target and
 * nowhere else. `focusin`/`focusout` are deliberately absent — they are the BUBBLING counterparts
 * of `focus`/`blur` and reach an ancestor perfectly well. Mirrors `DOES_NOT_BUBBLE` in
 * `base/decorators.ts`, which decides the same thing at runtime.
 */
const DOES_NOT_BUBBLE: ReadonlySet<string> = new Set([
  "mouseenter",
  "mouseleave",
  "pointerenter",
  "pointerleave",
  "focus",
  "blur",
  "load",
  "unload",
  "scroll",
  "error",
  "abort",
]);

/** Whether this class, or anything it extends, declares a `@Host` with a tag this can read. */
function hasAHost(cls: ts.ClassDeclaration, resolve: (id: ts.Node) => ts.Symbol | undefined): boolean {
  let at: ts.ClassLikeDeclaration | undefined = cls;

  for (let hop = 0; hop < 4 && at !== undefined; hop++) {
    for (const decorator of ts.getDecorators(at as ts.HasDecorators) ?? []) {
      const call = decorator.expression;
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
      if (call.expression.text === "Host") return true;
    }

    const base: ts.Expression | undefined = at.heritageClauses?.find(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
    )?.types[0]?.expression;
    if (base === undefined || (!ts.isIdentifier(base) && !ts.isPropertyAccessExpression(base))) return false;

    /**
     * The framework's own bases END the chain, and this is the fix for a real bug.
     *
     * `Component` and `Hook` carry no `@Host` — the default host is what a component gets by NOT
     * having one — so reaching either is the answer rather than the end of what can be seen.
     *
     * The first version treated any base it could not read as "has a host", and in a real
     * application `@ramonda/core` resolves to a `.d.ts`: so `class Bare extends Component` hit that
     * branch and the rule went silent for **every component anybody outside this repository would
     * ever write**. It only worked here because the workspace maps `@ramonda/core` at its source.
     * Measured against a project pointed at the built `.d.ts`, which is what a consumer has.
     */
    if (ts.isIdentifier(base) && (base.text === "Component" || base.text === "Hook")) return false;

    const declaration: ts.ClassLikeDeclaration | undefined = resolve(base)?.declarations?.find(
      (one): one is ts.ClassLikeDeclaration => ts.isClassLike(one),
    );
    if (declaration === undefined) return false;
    const file = declaration.getSourceFile();
    // Some OTHER base this cannot read — a component published by somebody else, which may well
    // carry a `@Host`. That one really is unknown, and unknown means silence.
    if (file.isDeclarationFile || file.fileName.includes("node_modules")) return true;
    at = declaration;
  }

  return false;
}

export const listenerOnTheDefaultHost = {
  id: "listener-on-the-default-host",

  report: {
    severity: "warn",
    reportedWhen:
      "`@onElement` is on a component with no `@Host`, so the listener sits on a `display: contents` host that has no box",
    alsoReportedAs: ["RMD042"],
    heading: (found) => `${found.length} listener(s) waiting for an event that cannot arrive:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>'s \`${issue.member}\` waits for "${issue.event}" on the default ` +
        `\`<ramonda-host>\`, which has \`display: contents\` and no box — and "${issue.event}" does ` +
        "not bubble, so it never arrives.",
    ],
    advice:
      'Without `@Host` a component\'s host is `<ramonda-host style="display: contents">`, and that\n' +
      "is the point of it: it takes part in no layout, so the markup inside lands in the parent's\n" +
      "grid or flex row as if the component were not there.\n\n" +
      "What it has no part in is being a target. `display: contents` generates no box, so nothing\n" +
      "can be over it and nothing can enter it.\n\n" +
      "A BUBBLING event is unaffected and is not reported: a click on a child reaches the listener\n" +
      "perfectly well, because bubbling needs an ancestor rather than a box. This event is\n" +
      "dispatched at its target and nowhere else, so it never arrives here at all.\n\n" +
      'Give the component a real element with `@Host("div")`, or move the listener onto the element\n' +
      "that should carry it and hand it a handler in the markup.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self, resolve }) {
    if (hasAHost(cls, resolve)) return [];

    const found: ListenerOnTheDefaultHostIssue[] = [];

    for (const member of cls.members) {
      if (member.name === undefined || !ts.isIdentifier(member.name)) continue;

      for (const decorator of ts.getDecorators(member as ts.HasDecorators) ?? []) {
        const call = decorator.expression;
        if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
        if (call.expression.text !== "onElement") continue;

        // The event as written. An expression this cannot read says nothing about whether it
        // bubbles, and that is the whole question.
        const written = call.arguments[0];
        if (written === undefined || !ts.isStringLiteralLike(written)) continue;
        if (!DOES_NOT_BUBBLE.has(written.text)) continue;

        found.push({
          component: self.name,
          member: member.name.text,
          event: written.text,
          ...positionOf(decorator),
        });
      }
    }

    return found;
  },
} as const satisfies Rule<ListenerOnTheDefaultHostIssue>;
