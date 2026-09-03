import ts from "typescript";
import { heritage } from "./render-reach";
import { hookNamed, isThisUse, positionOf } from "../syntax";
import type { Rule } from "./rule";

/**
 * A component that READS a form field it was handed, without watching it.
 *
 * Such a component never re-renders. Two things have to be true at once for that, and both are
 * deliberate: a field node is ONE cached object for the life of the form — a fresh one per access
 * means a fresh `bind.oninput` per access, which RMD020 reports — so the component's props never
 * change and the props diff skips it; and a hook's `@state` belongs to the component that used the
 * hook, so the form's counter wakes the form's OWNER and nobody else. The fix is `Field`, the hook
 * that subscribes the component to that one path.
 *
 * **Why this cannot be a runtime diagnostic.** The form would have to know who is rendering, and it
 * cannot: core's render phase is internal to core. Nothing in the running page can tell "the owner is
 * reading its own field" from "a child is reading a field it will never hear about again". Statically
 * it is plain, which is why it lives here — and it is the one silent failure the form package has
 * left, so it is worth a build gate rather than a note in the docs.
 *
 * **Only a READ counts.** A component that only WRITES through a field it was handed — `set` from a
 * click handler — is correct as written: writing needs no subscription, and the component showing the
 * value is somebody else. Reporting those would be reporting working code.
 */
export interface UnwatchedFieldIssue {
  /** The component doing the reading. */
  component: string;
  /** The member it read — `value`, `error`, `bind`, … — which is what would never update. */
  member: string;
  file: string;
  line: number;
  column: number;
}

/**
 * The members of a field's API whose answer MOVES, which is what makes reading one a subscription.
 *
 * `set`, `reset`, `append`, `insert`, `remove` and `move` are absent on purpose: a component that only
 * writes through a field it was handed is correct as written, because writing needs no subscription.
 * `path` and `name` are absent because they are fixed for the life of the field — a component reading
 * only the `name` to label something has nothing to hear about.
 */
const FIELD_READS = new Set(["value", "error", "errors", "touched", "dirty", "bind", "rows", "length"]);

/** The hook that watches one field. Named rather than resolved — see the rule's note below. */
const WATCH_HOOK = "Field";

/**
 * Whether a property chain starts at `this.props`.
 *
 * Element access is walked too, so `this.props.rows[0].v.$` is seen for what it is.
 */
function rootedInProps(node: ts.Node): boolean {
  let at: ts.Node = node;
  while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) {
    if (
      ts.isPropertyAccessExpression(at) &&
      at.name.text === "props" &&
      at.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      return true;
    }
    at = at.expression;
  }
  return false;
}

/** Whether an expression is a `$` reached from `this.props` — the handle of a field handed over. */
function handedOver(node: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(node) && node.name.text === "$" && rootedInProps(node);
}

/**
 * A form field read by a component that does not watch it.
 *
 * The shape looked for is a property chain that starts at `this.props`, passes through `$`, and ends
 * at a member whose answer moves. Two passes, because the `use` may be written below the read:
 * the first asks whether this class watches anything and which locals hold a field it was handed, the
 * second looks for the reads.
 *
 * **The hook is matched by NAME rather than resolved to `@ramonda/form`.** Resolving it would be
 * stricter, and it would also make the check silent for a re-export — an app's own
 * `export { Field } from "@ramonda/form"`, or a wrapper hook named `Field` that uses it. A local class
 * of that name is the cost, and the direction of the mistake is what settles it: a false negative here
 * is the silent never-re-renders bug shipping, and a false positive is a line of advice about a name
 * somebody chose.
 *
 * That reasoning is also why this rule declares no `needs`. Gating it on an import of
 * `@ramonda/form` would undo the paragraph above: the re-export it is written to survive is exactly
 * the case where the app does not import the package by name.
 */
export const unwatchedFields = {
  id: "unwatched-fields",

  report: {
    severity: "error",
    reportedWhen:
      "a component reads a form field it does not watch, so it never re-renders when that " + "field changes",
    heading: (found) => `${found.length} component(s) reading a form field they do not watch:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> reads \`${issue.member}\` from a field in its props, so it will\n` +
        `    never show a change to it — the component does not re-render at all.`,
      "",
    ],
    advice:
      "Two deliberate things make that so: a field node is ONE object for the life of the form, so the\n" +
      "props diff has nothing to notice and skips the component; and a hook's state belongs to whoever\n" +
      "used the hook, so the form's counter wakes the form's owner and nobody else.\n\n" +
      "Watch the field, and the component wakes when that one field changes:\n\n" +
      "    f = this.use(Field<string>, () => ({ of: this.props.of }));\n" +
      "    render() { return <input {...this.f.bind} />; }\n\n" +
      "A component that only WRITES through a field is correct as written and is not reported.",
  },

  read(cls, { self, resolve }) {
    let watches = false;
    /** Locals holding a handle the component was handed — `const f = this.props.of.$`. */
    const held = new Set<string>();

    /**
     * The BASES too, for the watch — a hook belongs to the INSTANCE, so a base's
     * `this.use(Field, …)` subscribes the subclass exactly as its own would.
     *
     * Reading one class body made a subclass that reads what its base watches an ERROR on working
     * code. Measured with a plant.
     *
     * The other direction is out of reach and stays that way: a base that READS while the subclass
     * watches is reported at the base, which cannot see who extends it. The shape is odd — a watch
     * belongs where the read is — and the chain here, as everywhere in this package, is walked
     * upward only.
     */
    for (const declaring of heritage(cls, resolve)) {
      ts.forEachChild(declaring, function inherited(node) {
        if (ts.isCallExpression(node) && isThisUse(node)) {
          const arg = node.arguments[0];
          const named = arg === undefined ? undefined : hookNamed(arg);
          if (named !== undefined && ts.isIdentifier(named) && named.text === WATCH_HOOK) watches = true;
        }
        ts.forEachChild(node, inherited);
      });
    }

    ts.forEachChild(cls, function first(node) {
      if (ts.isCallExpression(node) && isThisUse(node)) {
        const arg = node.arguments[0];
        const named = arg === undefined ? undefined : hookNamed(arg);
        if (named !== undefined && ts.isIdentifier(named) && named.text === WATCH_HOOK) watches = true;
      }

      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        handedOver(node.initializer)
      ) {
        held.add(node.name.text);
      }

      ts.forEachChild(node, first);
    });

    if (watches) return [];

    // One report per component: every read has the same cause and the same fix, and a component showing
    // a field reads three or four of them — `value`, `error`, `bind`. A list of them would say one thing
    // four times and bury the next component.
    const found: UnwatchedFieldIssue[] = [];

    ts.forEachChild(cls, function second(node) {
      if (found.length > 0) return;

      if (ts.isPropertyAccessExpression(node) && FIELD_READS.has(node.name.text)) {
        const from = node.expression;
        const throughProps = ts.isPropertyAccessExpression(from) && from.name.text === "$" && rootedInProps(from);
        const throughLocal = ts.isIdentifier(from) && held.has(from.text);

        if (throughProps || throughLocal) {
          found.push({ component: self.name, member: node.name.text, ...positionOf(node) });
          return;
        }
      }

      ts.forEachChild(node, second);
    });

    return found;
  },
} as const satisfies Rule<UnwatchedFieldIssue>;
