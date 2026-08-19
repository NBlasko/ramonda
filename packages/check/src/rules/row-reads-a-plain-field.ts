import ts from "typescript";
import { positionOf } from "../syntax";
import type { ModuleRule } from "./rule";

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
 * **A field nothing writes.** No write, no staleness — a `readonly` list of options held in a field is
 * the ordinary way to write that, and reporting it would report correct code.
 *
 * **A field only written in `@created`.** That runs before the first render, so every row is built after
 * the value is decided.
 *
 * **A value that never reaches the output.** `this.socket.send(…)`, `this.observer.observe(el)`,
 * `this.cache.get(id)` used for its side effect — a plain field is the only home for anything a
 * `WebSocket`, an `AbortController` or a `Map` lives in, because `@state` and `@persist` must be
 * JSON. Those are the point of a plain field, not a mistake, and none of them is rendered.
 *
 * ## The one thing it cannot see, which it says out loud
 *
 * `<li>{labelOf(this)}</li>` hands the component to a function that reads it somewhere else. The reads
 * are then not in this declaration and this cannot answer for them — so rather than going quiet on a
 * shape it cannot analyse, it reports the shape. That is a proven fact (`this` left) rather than a
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

/** Decorators that make a member reactive, so a row records reading it. */
const REACTIVE = new Set(["state", "compute", "persist"]);

/** A member's own name, when it has a plain one to go by. */
function memberName(member: ts.ClassElement): string | undefined {
  return member.name !== undefined && ts.isIdentifier(member.name) ? member.name.text : undefined;
}

/** The decorator names written on a member, by the identifier as typed. */
function decoratorNames(member: ts.ClassElement): string[] {
  const names: string[] = [];
  // `ts.getDecorators` wants a node the API knows CAN carry them; a `ClassElement` includes shapes
  // that cannot (an index signature, a semicolon). Asking only the two that can keeps the cast out.
  if (!ts.canHaveDecorators(member)) return names;
  for (const decorator of ts.getDecorators(member) ?? []) {
    const call = decorator.expression;
    const id = ts.isCallExpression(call) ? call.expression : call;
    if (ts.isIdentifier(id)) names.push(id.text);
  }
  return names;
}

/** `this.<name>`, and the name. */
function thisRead(node: ts.Node): { name: string; at: ts.PropertyAccessExpression } | undefined {
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  if (node.expression.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
  if (!ts.isIdentifier(node.name)) return undefined;
  return { name: node.name.text, at: node };
}

/**
 * The local name this file gave `list`, or `undefined` when it did not import one.
 *
 * By the module specifier the reader typed rather than by the name: an app is entitled to its own
 * function called `list`, and the import statement is the evidence. Same reason `late-request-read`
 * goes by the specifier.
 */
function listLocalName(file: ts.SourceFile): string | undefined {
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const from = statement.moduleSpecifier;
    if (!ts.isStringLiteral(from)) continue;
    if (from.text !== "@ramonda/core" && !from.text.startsWith("..")) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === "list") return element.name.text;
    }
  }
  return undefined;
}

/**
 * Which members are written somewhere other than their own initializer and `@created`.
 *
 * A field nothing assigns cannot go stale, and a field decided in `@created` is decided before the
 * first row exists. Both are the ordinary way to hold a constant on an instance, so both are silent.
 */
function writtenMembers(cls: ts.ClassDeclaration): Set<string> {
  const written = new Set<string>();
  for (const member of cls.members) {
    if (decoratorNames(member).includes("created")) continue;
    const body = ts.isPropertyDeclaration(member) ? member.initializer : member;
    if (body === undefined) continue;
    (function look(node: ts.Node): void {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const target = thisRead(node.left);
        if (target !== undefined) written.add(target.name);
      }
      // `this.count++` and `this.total += n` move a value just as much as `=` does.
      if (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
        const target = thisRead(node.operand);
        if (target !== undefined) written.add(target.name);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstCompoundAssignment) {
        const target = thisRead(node.left);
        if (target !== undefined) written.add(target.name);
      }
      ts.forEachChild(node, look);
    })(body);
  }
  return written;
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
            `    <${issue.component}>.${issue.through} hands \`this\` to \`${issue.name}\`, so what the row`,
            `    reads is decided outside this declaration and cannot be checked here.`,
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
    const listName = listLocalName(file);
    if (listName === undefined) return found;

    const visitClass = (cls: ts.ClassDeclaration): void => {
      const members = new Map<string, ts.ClassElement>();
      const reactive = new Set<string>(["props"]);
      for (const member of cls.members) {
        const name = memberName(member);
        if (name === undefined) continue;
        members.set(name, member);
        if (decoratorNames(member).some((d) => REACTIVE.has(d))) reactive.add(name);
      }
      const written = writtenMembers(cls);
      const component = cls.name?.text ?? "(anonymous)";

      /** The stable callbacks handed to `list()` in this class. */
      const callbacks = new Set<string>();
      (function look(node: ts.Node): void {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === listName) {
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
                const issue = context.unlessAnnotated(node, () => ({
                  kind: "opaque-call" as const,
                  component,
                  callback,
                  through: name,
                  name: node.expression.getText(),
                  ...positionOf(node),
                }));
                if (issue !== undefined) found.push(issue);
              }
            }

            const read = thisRead(node);
            if (read !== undefined) {
              const target = read.name;
              // A member called from here, whose own reads leave through this one.
              if (ts.isCallExpression(node.parent) && node.parent.expression === read.at) {
                if (members.has(target) && leaves(node.parent)) walkMember(target);
              } else if (!reactive.has(target) && written.has(target) && leaves(node)) {
                const issue = context.unlessAnnotated(read.at, () => ({
                  kind: "plain-field" as const,
                  component,
                  callback,
                  through: name,
                  name: target,
                  ...positionOf(read.at),
                }));
                if (issue !== undefined) found.push(issue);
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
