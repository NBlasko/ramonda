import ts from "typescript";
import { memberName, positionOf } from "../syntax";
import type { ModuleRule } from "./rule";
// The field judgement, shared with `cached-read-of-a-plain-field`. A row callback is a third
// CACHED reader, so which fields can be stale and which writes count is the same question, with
// the same exemptions. It is imported rather than repeated because the repeat drifted: this rule
// once exempted only `@created`, so it reported the constructor, the memo pattern and
// `@destroyed`, and it treated `@persist` as reactive when nothing tracks it.
import { importedFromCore } from "./core-import";
import { heritage } from "./render-reach";
import { staleFieldsOf } from "./stale-field";

/**
 * A `list()` row callback that shows a field nothing can track.
 *
 * A row is rebuilt when something it READ has moved, and the reads are recorded by a tracker while the
 * callback runs — every signal, at any call depth, in any module. A plain field is not a signal, so
 * nothing is recorded and nothing marks the row. The value then sits in the DOM until something else
 * rebuilds that row.
 *
 * ```tsx
 * class Board extends Component {
 *   label = "old";                                    // not `@state`
 *   row(t: Task) { return <li>{t.title} {this.label}</li>; }
 *   render() { return <ul>{list(this.tasks, this.row)}</ul>; }
 * }
 * ```
 *
 * Write `this.label = "new"` and the markup outside the list shows `new` on the next render, because
 * `render()` runs whole and re-reads it. The row shows `old`, because a reused row does not run at all.
 * Measured, one field read twice in one component: `new` outside, `old` inside.
 *
 * ## Why the runtime cannot catch this and a compiler can
 *
 * There is nothing to observe. A signal read goes through a getter that records it; a plain field read
 * is a property access and leaves no trace. The double render cannot see it either — both calls are in
 * one tick, so the field has the same value in both. The declaration is the only evidence there is,
 * which is what puts this here.
 *
 * ## What it does NOT report, and each silence is a decision
 *
 * **An inline callback.** A fresh reference every render, so the engine rebuilds every row and reads the
 * field again. Nothing to be stale.
 *
 * **Anything `stale-field.ts` exempts**, which is the same list `cached-read-of-a-plain-field` uses: a
 * field nothing writes, a write in the constructor or `@created` (both before the first render), a write
 * from inside `render()` or a `@compute` (the memo pattern, where advising `@state` advises a loop), a
 * write in `@destroyed` (after the last render), and a field holding a hook or a function. `@persist` is
 * NOT among them — it is carried across hydration without being tracked, so a row that shows one is as
 * stale as a row showing any other field.
 *
 * **A value that never reaches the output.** `this.socket.send(…)`, `this.observer.observe(el)`,
 * `this.cache.get(id)` used for its side effect — a plain field is the only home for anything a
 * `WebSocket`, an `AbortController` or a `Map` lives in, because `@state` and `@persist` must be
 * JSON. Those are the point of a plain field, not a mistake, and none of them is rendered.
 *
 * ## The one thing it cannot see, which it says out loud
 *
 * `<li>{labelOf(this)}</li>` hands the component over as a value, so the row's reads happen through a
 * PARAMETER — `owner.label` rather than `this.label` — and nothing here follows that. It is the same
 * whether the callee is a foreign function or a method of this very class, which is why the report says
 * "through a parameter" and not "outside this declaration": a sibling method is inside the declaration
 * and still unfollowable this way. Rather than going quiet on a shape it cannot analyse, it reports the
 * shape. That is a proven fact (`this` left) rather than a
 * guessed defect, and it is what makes the guarantee sayable: **a row callback either reads its members
 * where this can see them, or it says it does not.** Measured across this monorepo, 53 calls take a bare
 * `this` and every one is inside the framework itself — none in application code, none in a row
 * callback. The blind spot is empty, and now it is also visible.
 */
export interface RowReadsAPlainFieldIssue {
  /** Which of the two findings this is. */
  kind: "plain-field" | "opaque-call";
  /** The class the callback belongs to. */
  component: string;
  /** The member used as the row callback, as the reader would find it. */
  callback: string;
  /** The member holding the read, when it is not the callback itself. */
  through: string;
  /** The plain field, or the function `this` was handed to. */
  name: string;
  file: string;
  line: number;
  column: number;
}

/** `this.<name>`, and the name. */
function thisRead(node: ts.Node): { name: string; at: ts.PropertyAccessExpression } | undefined {
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  if (node.expression.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
  if (!ts.isIdentifier(node.name)) return undefined;
  return { name: node.name.text, at: node };
}

/**
 * The values a member hands back — what a caller can put in the markup.
 *
 * A read only matters when it LEAVES: `this.observer.observe(el)` is the reason a plain field exists,
 * and reporting it would report the fix. So a read counts when it is inside a returned expression, or
 * inside the initializer of a local that a returned expression then names. One hop, because
 * `const v = this.label; return <li>{v}</li>` is how people write it and refusing to follow it would
 * make the rule easy to defeat by accident rather than on purpose.
 */
function outboundReads(member: ts.ClassElement): (node: ts.Node) => boolean {
  const returned: ts.Node[] = [];
  const body = ts.isPropertyDeclaration(member) ? member.initializer : member;

  if (body !== undefined) {
    (function look(node: ts.Node): void {
      if (ts.isReturnStatement(node) && node.expression !== undefined) returned.push(node.expression);
      // A concise arrow — `row = (t) => <li>{this.label}</li>` — returns without saying so.
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) returned.push(node.body);
      ts.forEachChild(node, look);
    })(body);
  }

  /** Locals a returned expression names, so their initializers leave too. */
  const carried = new Set<string>();
  for (const expression of returned) {
    (function look(node: ts.Node): void {
      if (ts.isIdentifier(node)) carried.add(node.text);
      ts.forEachChild(node, look);
    })(expression);
  }

  const inside = (node: ts.Node, container: ts.Node): boolean => {
    for (let at: ts.Node | undefined = node; at !== undefined; at = at.parent) {
      if (at === container) return true;
    }
    return false;
  };

  return (node) => {
    if (returned.some((expression) => inside(node, expression))) return true;
    for (let at: ts.Node | undefined = node; at !== undefined; at = at.parent) {
      if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) return carried.has(at.name.text);
    }
    return false;
  };
}

export const rowReadsAPlainField = {
  id: "row-reads-a-plain-field",

  report: {
    /**
     * A WARNING, and the one thing it cannot prove is WHEN the write happens.
     *
     * Everything else is read off the declaration: the callback is a stable reference, so the engine may
     * reuse the row; the field carries no reactive decorator, so no read is recorded; the field is
     * assigned somewhere; the value reaches the markup. What is left open is whether that assignment
     * happens while the row exists — a write in a handler that also replaces the whole array would
     * rebuild every row anyway. So the report names the field and lets the reader close it, rather than
     * failing a build over a sequence it cannot see.
     */
    severity: "warn",
    reportedWhen:
      "a `list()` row callback puts a field nothing can track into the markup, so a reused row keeps the old value",
    heading: (found) => `${found.length} row callback read(s) that a rebuild cannot follow:`,
    lines: (issue) =>
      issue.kind === "plain-field"
        ? [
            `  ${issue.file}:${issue.line}:${issue.column}`,
            `    <${issue.component}>.${issue.through} shows \`this.${issue.name}\` in a row, and \`${issue.name}\``,
            `    is not \`@state\` — nothing records the read, so a reused row keeps the old value.`,
            `    The callback is \`this.${issue.callback}\`, which is stable, so rows ARE reused.`,
          ]
        : [
            `  ${issue.file}:${issue.line}:${issue.column}`,
            `    <${issue.component}>.${issue.through} hands \`this\` to \`${issue.name}\` as a value, so the`,
            `    row's reads happen through a parameter and cannot be checked here.`,
            `    Pass the values instead: \`${issue.name}(this.someField)\`.`,
          ],
    advice:
      "A row is rebuilt when something it READ has moved, and the reads are recorded while the\n" +
      "callback runs — every signal, at any depth, in any module. A plain field is not a signal, so\n" +
      "there is nothing to record and nothing marks the row.\n\n" +
      "`render()` gets away with the same read because it runs whole and re-reads everything. A\n" +
      "reused row does not run at all, which is why one field can show two values in one component.\n\n" +
      "Two fixes, and the first is a word:\n\n" +
      "    @state label = 'old';                        // recorded, so the row wakes up\n\n" +
      "    list(this.tasks, (t) => <li>{this.label}</li>)   // inline: every row rebuilds anyway\n\n" +
      "An inline callback costs a callback call and a vnode per row per render, and — measured at\n" +
      "10 000 rows over five re-renders — no extra DOM work at all, so a short list pays nothing you\n" +
      "can notice.\n\n" +
      "**A plain field is not the problem, and this does not ask you to stop using one.** It is the\n" +
      "only home for anything that cannot be JSON — a `WebSocket`, an `AbortController`, a `Map` of\n" +
      "nodes — because `@state` and `@persist` are serialised into the page. None of those is\n" +
      "rendered, and a read that never reaches the markup is never reported.\n\n" +
      "**When `this` is handed to a function**, the reads happen in that function and this cannot\n" +
      "answer for them. Pass the values rather than the component, which is better code anyway: a\n" +
      "function taking the whole component can read anything. If it needs several, group them in a\n" +
      "method or a `@compute` on the class — that stays inside what this can follow.\n\n" +
      "If a stale value is what you want, say so and it goes quiet:\n\n" +
      "    // ramonda-check-ignore a hover count, stale until the row rebuilds is fine\n",
  },

  read(file, context) {
    const found: RowReadsAPlainFieldIssue[] = [];

    const visitClass = (cls: ts.ClassDeclaration): void => {
      /**
       * This class and its BASES, because a base's member is the component's member.
       *
       * A row callback inherited from a shared base, showing a plain field declared on that base,
       * is one instance and one stale row — and reading a single class body said nothing about it.
       * Measured with a plant, on the same axis that had already found five rules stopping here.
       *
       * NEAREST first, so a subclass overriding the callback is the one that is judged.
       */
      const declaring = [cls, ...heritage(cls, context.resolve)];
      const members = new Map<string, ts.ClassElement>();
      for (const declaringClass of declaring) {
        for (const member of declaringClass.members) {
          const name = memberName(member);
          if (name !== undefined && !members.has(name)) members.set(name, member);
        }
      }
      /** field → the member that writes it after the first render. Empty means nothing can be stale. */
      const stale = staleFieldsOf(cls, context.resolve);
      if (stale.size === 0) return;
      const component = cls.name?.text ?? "(anonymous)";

      /** The stable callbacks handed to `list()` in this class. */
      const callbacks = new Set<string>();
      (function look(node: ts.Node): void {
        /**
         * The framework's `list`, RESOLVED rather than matched by name — and by the name core
         * EXPORTS, which is the half that makes it a question about `list` at all.
         *
         * This used to scan the file's imports for a binding called `list` and take the first one,
         * so a file that also imported it under an alias got the wrong name, and a re-export
         * — `export { list } from "@ramonda/core"` in an app's own `ui` module — was invisible.
         * `importedFromCore` follows the chain, and still leaves an app's own function called
         * `list` alone, which is what `own-list.ts` in the fixture is for.
         *
         * Asking only "did this come from core" made EVERY core function a row builder:
         * `createContext({ n: 0 }, this.row)` was read as a list of rows. Found by planting it —
         * see `OtherCoreCall` in the fixture.
         */
        if (
          ts.isCallExpression(node) &&
          importedFromCore(node.expression, context.resolveLocal, context.resolveStep, "list")
        ) {
          const builder = node.arguments[1];
          const read = builder === undefined ? undefined : thisRead(builder);
          // Only a stable reference. An inline arrow or function makes the engine rebuild every row,
          // so there is nothing that can go stale — see the note on the interface above.
          if (read !== undefined && members.has(read.name)) callbacks.add(read.name);
        }
        ts.forEachChild(node, look);
      })(cls);

      for (const callback of callbacks) {
        const seen = new Set<string>();

        const walkMember = (name: string): void => {
          if (seen.has(name)) return;
          seen.add(name);
          const member = members.get(name);
          if (member === undefined) return;
          const leaves = outboundReads(member);
          const body = ts.isPropertyDeclaration(member) ? member.initializer : member;
          if (body === undefined) return;

          (function look(node: ts.Node): void {
            // `this` handed out — the one shape this cannot follow, reported as such.
            if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
              const handedOut = (node.arguments ?? []).some((a) => a.kind === ts.SyntaxKind.ThisKeyword);
              if (handedOut && leaves(node)) {
                found.push({
                  kind: "opaque-call" as const,
                  component,
                  callback,
                  through: name,
                  name: node.expression.getText(),
                  ...positionOf(node),
                });
              }
            }

            const read = thisRead(node);
            if (read !== undefined) {
              const target = read.name;
              // A member called from here, whose own reads leave through this one.
              if (ts.isCallExpression(node.parent) && node.parent.expression === read.at) {
                if (members.has(target) && leaves(node.parent)) walkMember(target);
              } else if (stale.has(target) && leaves(node)) {
                found.push({
                  kind: "plain-field" as const,
                  component,
                  callback,
                  through: name,
                  name: target,
                  ...positionOf(read.at),
                });
              }
            }

            ts.forEachChild(node, look);
          })(body);
        };

        walkMember(callback);
      }
    };

    (function look(node: ts.Node): void {
      if (ts.isClassDeclaration(node)) visitClass(node);
      ts.forEachChild(node, look);
    })(file);

    return found;
  },
} satisfies ModuleRule<RowReadsAPlainFieldIssue>;
