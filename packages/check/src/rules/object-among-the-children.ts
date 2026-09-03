import ts from "typescript";
import { positionOf } from "../syntax";
import { follow, type Looking, shorten } from "./follow-value";
import type { ElementRule } from "./rule";

/**
 * A plain object written among an element's children.
 *
 * The runtime drops it. `vdom/h.ts` walks the children, and anything that is an object but not a
 * vnode, a list descriptor or an array is replaced by a hole — *"an object that is not a vnode has
 * nothing the diff can do with it"*. `RMD037` says so in a development build, naming the kind:
 * `A [object Object] among the children of Panel, dropped from the render.`
 *
 * ## Why it is worth reading from the source
 *
 * The failure is SILENT and it looks like data. Nothing throws, nothing is red — the page simply
 * renders without the thing, and the author's eye goes to the fetch, the state and the condition
 * before it goes to the one child that was never markup. Almost always the line meant
 * `{item.name}` and stopped a word early.
 *
 * ## What it can prove, and where it stops
 *
 * An object LITERAL, wherever it is written: in the child, in a `const` one line up, in a module
 * constant, or on one arm of a branch — a branch is followed because the arm that holds the object
 * really is dropped whenever that arm is taken, and that is the whole fault.
 *
 * **A module-level `const` counts here**, which is the opposite of `fresh-object-in-props`. The
 * two ask different questions of the same walk: "is this value REBUILT?" — where a module constant
 * is the documented fix — and "what IS this value?", where a module constant is still an object
 * and the runtime still drops it.
 *
 * ## What is NOT reported
 *
 * **An ARRAY.** The runtime flattens one into the children rather than dropping it; a group is
 * markup.
 *
 * **A CALL.** `{build()}` may hand back a vnode on the path that matters, and this rule reports
 * something DROPPED from the page — a report there would be a claim about what the page shows,
 * made without the proof.
 *
 * **A prop, a field, anything read off something.** `{this.props.item}` is not knowable from here,
 * and reading a field off an object — `{item.name}` — is what the fixed line looks like.
 *
 * **A vnode, a list, a string, a number.** All of them render.
 */
export interface ObjectAmongTheChildrenIssue {
  /** The tag whose children it sits in, so the report reads like the line. */
  parent: string;
  /** How it is written, because `{config}` and `{{…}}` are the same fault and read differently. */
  written: string;
  /** Where the object is built, when that is not this line — a local, or a module constant. */
  builtIn: string | undefined;
  file: string;
  line: number;
  column: number;
}

/**
 * Looking for something that certainly IS a plain object.
 *
 * Not an array: the runtime flattens one into the children, so a group is markup and reporting it
 * would report correct code. Not through a CALL either — a helper may hand back a vnode, and this
 * rule's claim is that the page is missing something.
 */
const AN_OBJECT: Looking<"object"> = {
  leaf: (expression) => (ts.isObjectLiteralExpression(expression) ? "object" : undefined),
  // A module constant is still an object among the children — the opposite answer from
  // `fresh-object-in-props`, and for the opposite question. See the note above.
  throughModuleScope: true,
  throughBranches: true,
  throughCalls: false,
  throughMutableBindings: true,
  throughMemoizedCalls: true,
};

export const objectAmongTheChildren = {
  id: "object-among-the-children",

  report: {
    severity: "error",
    reportedWhen:
      "a plain object is written among an element's children, where the runtime drops it and the page renders without it",
    alsoReportedAs: "RMD037",
    heading: (found) => `${found.length} object(s) among children, which the render drops:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.parent}>{${issue.written}}</${issue.parent}> is a plain object${
        issue.builtIn === undefined ? "" : `, built in ${issue.builtIn}`
      }, so nothing of it reaches the page.`,
    ],
    advice:
      "An object among children is not markup and the runtime has nothing to do with it, so it is\n" +
      "replaced by a hole. Nothing throws and nothing is red — the page just renders without it,\n" +
      "which is the slowest kind of wrong to find.\n\n" +
      "Almost always the line stopped a word early: `{item}` where `{item.name}` was meant. Where\n" +
      "the whole object really is what you want to see, say how — `{JSON.stringify(item)}` in a\n" +
      "debugging view, or a component that takes it as a prop and renders the parts.\n\n" +
      "An ARRAY is not this: the runtime flattens one into the children, so a group of nodes is\n" +
      "markup and is never reported.\n\n",
  },

  read(element, { resolve }) {
    const found: ObjectAmongTheChildrenIssue[] = [];
    const parent = ts.isJsxElement(element) ? element.openingElement.tagName.getText() : undefined;
    if (parent === undefined || !ts.isJsxElement(element)) return found;

    for (const child of element.children) {
      if (!ts.isJsxExpression(child) || child.expression === undefined) continue;
      const built = follow(child.expression, resolve, AN_OBJECT, 0);
      if (built === undefined) continue;

      found.push({
        parent,
        written: shorten(child.expression),
        builtIn: built.foundIn,
        ...positionOf(child),
      });
    }

    return found;
  },
} as const satisfies ElementRule<ObjectAmongTheChildrenIssue>;
