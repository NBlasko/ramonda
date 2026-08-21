import ts from "typescript";
import { memberName, positionOf } from "../syntax";
import { isTheGlobal } from "./globals";
import { isServerOnly } from "./lifecycle-env";
import type { Rule, RuleContext } from "./rule";

/**
 * `process.env` read from a member the browser also runs.
 *
 * `process` does not exist in a browser, so the read is a `ReferenceError` on the page — not an
 * `undefined`, a crash. And it is a crash that a development run can hide: a Vite dev server may shim
 * enough of `process` to get through, so the fault waits for the production bundle.
 *
 * ## Why "not marked" means "the browser gets here"
 *
 * That is the whole asymmetry with `client-only-request-read`, which asks the opposite question of the
 * same decorators. `render()` runs on both sides. A field initializer runs on both sides. `@created`,
 * `@mounted` and `@destroyed` default to `shared`. So a member has to SAY `{ env: "server" }` to be
 * excused, and every other member in a component is somewhere the browser reaches.
 *
 * ## What to write instead
 *
 * Either move the read to a server-only lifecycle and keep the answer in `@state`, which is serialised
 * into the page — or, if the value is not a secret, rename it `RAMONDA_PUBLIC_…` and read it with
 * `import.meta.env`, which both bundlers compile into a literal on both sides.
 *
 * ## What it does not judge
 *
 * A `process.env` read at MODULE scope, outside any class. A server entry legitimately reads one there,
 * and whether a given module ends up in the client bundle is a question about the import graph rather
 * than about this file — so it is left alone, by the rule this package is held to.
 */
export interface ServerEnvInSharedCodeIssue {
  /** The class the read is in. */
  component: string;
  /** The member holding it, as a reader would find it. */
  member: string;
  /** What was written — `process.env.DATABASE_URL`. */
  read: string;
  file: string;
  line: number;
  column: number;
}

/**
 * `process.env` — Node's, not a local of the same name.
 *
 * The distinction is `browser-url`'s, and the same trick answers it: the analyzer builds its program with
 * `noLib` and no `@types/node`, so **Node's `process` resolves to nothing** while a `const process = …` or
 * a `declare const process` in the source resolves to its declaration. A file that shims `process` for
 * browser code is therefore left alone, which it must be — the shim is the fix, and reporting it would be
 * reporting the reader's own answer.
 */
function processEnvRead(node: ts.Node, context: RuleContext): ts.Node | undefined {
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  if (node.name.text !== "env") return undefined;

  const target = node.expression;

  /**
   * `globalThis.process.env.X` — the same object under the name every environment agrees on, and it
   * was silent because this required `process` to be a bare identifier.
   *
   * `globals.ts` decides what names the global object, so the three rules that ask agree: a name
   * the source can shadow has to be proved not to be, and `globalThis` cannot be shadowed.
   */
  if (
    ts.isPropertyAccessExpression(target) &&
    target.name.text === "process" &&
    isTheGlobal(target.expression, context.resolve)
  ) {
    return node;
  }

  if (!ts.isIdentifier(target) || target.text !== "process") return undefined;
  return context.resolve(target) === undefined ? node : undefined;
}

/**
 * Every member the browser cannot reach — the ones marked `{ env: "server" }`, and the helpers only
 * those call.
 *
 * **The second half is why this exists**, and leaving it out was a false positive on the very shape this
 * rule's advice recommends: read the variable in a server-only lifecycle, and the moment the read is
 * factored into a helper the helper is reported. Verified against a fixture before it was fixed.
 *
 * A helper counts as excused when EVERY reference to it inside this class sits in a member that is
 * already excused — the same one-hop, same-class question `client-only-request-read` asks of its
 * handlers, and the same reason it is safe: it is the declaration in front of us, not the general
 * dataflow this package refuses.
 *
 * Iterated to a fixed point, because a helper may call a helper. It converges: each pass can only add
 * names, and there are finitely many.
 */
function serverOnlyMembers(cls: ts.ClassDeclaration, context: RuleContext): Set<string> {
  const excused = new Set<string>();
  for (const member of cls.members) {
    const name = memberName(member);
    if (name !== undefined && isServerOnly(member, context)) excused.add(name);
  }

  /** Which members hold a `this.<name>` reference, so a helper can be asked who calls it. */
  const callers = new Map<string, Set<string>>();
  for (const member of cls.members) {
    const from = memberName(member);
    if (from === undefined) continue;
    (function look(node: ts.Node): void {
      if (
        ts.isPropertyAccessExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ThisKeyword &&
        ts.isIdentifier(node.name)
      ) {
        const to = node.name.text;
        const into = callers.get(to) ?? new Set<string>();
        into.add(from);
        callers.set(to, into);
      }
      ts.forEachChild(node, look);
    })(member);
  }

  /**
   * A `private` or `protected` member NOTHING in this class references, which is a different
   * silence from the one below it and the reason this runs before the loop.
   *
   * The stance for a member with no reference is "it may be called from anywhere, so it is not
   * excused on silence" — and that is right for a PUBLIC one. It is not right once a class has
   * subclasses: `protected` narrows the callers to this chain, and a chain is walked upward here,
   * never down. So a base's `protected fromDb()` whose only caller is a server-only lifecycle in a
   * subclass was reported as browser code — measured, on the very shape this rule's advice
   * recommends, one class further along.
   *
   * `private` is quieter still: with no reference in its own class, nothing anywhere can call it.
   *
   * **The miss this leaves, written down rather than discovered.** A subclass that calls such a
   * helper from `render()` is a real fault and is reported by nothing: the read is on the base,
   * which cannot see the caller, and the subclass's pass does not walk the base's members. A miss
   * is the safe direction here and a false ERROR on a working pattern is not.
   */
  const referenced = new Set(callers.keys());
  for (const member of cls.members) {
    const name = memberName(member);
    if (name === undefined || referenced.has(name)) continue;
    const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
    // `#name` carries no modifier — the `#` IS the privacy, and it is the stronger of the two: a
    // `#` member cannot be named from outside the class at all, while `private` is TypeScript's
    // word and a cast walks straight through it.
    const hidden =
      (member.name !== undefined && ts.isPrivateIdentifier(member.name)) ||
      modifiers.some(
        (modifier) =>
          modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword,
      );
    if (hidden) excused.add(name);
  }

  if (excused.size === 0) return excused;

  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, from] of callers) {
      if (excused.has(name) || from.size === 0) continue;
      // Every caller excused, and at least one — a member nothing in this class references may be
      // called from anywhere, so it is not excused on silence.
      if ([...from].every((caller) => excused.has(caller))) {
        excused.add(name);
        changed = true;
      }
    }
  }
  return excused;
}

export const serverEnvInSharedCode = {
  id: "server-env-in-shared-code",

  report: {
    // An ERROR, not the usual warning-first: `process` is not defined in a browser, so this is a page
    // that throws rather than a page that is slower or wronger than it could be.
    severity: "error",
    reportedWhen: "`process.env` is read from a member the browser also runs, where `process` does not exist",
    heading: (found) => `${found.length} server-only environment read(s) in code the browser runs:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>.${issue.member} reads \`${issue.read}\`, and \`process\` does not`,
      `    exist in a browser — the page throws when this line runs there.`,
    ],
    advice:
      "`process.env` is the SERVER's half of the environment. A component's members are not the\n" +
      "server's: `render()` runs on both sides, so does a field initialiser, and `@created`,\n" +
      '`@mounted` and `@destroyed` default to `shared`. Only `{ env: "server" }` says otherwise.\n\n' +
      "So either read it where the server is, and keep the answer:\n\n" +
      '    @state private region = "";\n' +
      '    @created({ env: "server" }) read() { this.region = process.env.REGION ?? ""; }\n\n' +
      "`@state` is serialised into the page, so the browser reads back what the server decided and\n" +
      "hydration agrees.\n\n" +
      "Or, if the value is not a secret, publish it deliberately: rename it `RAMONDA_PUBLIC_REGION`\n" +
      "and read `import.meta.env.RAMONDA_PUBLIC_REGION`, which both bundlers compile into a literal\n" +
      "on both sides. The prefix is how a variable is marked safe to ship — see /reference/build.\n\n" +
      "A read at module scope, outside a class, is not reported: a server entry legitimately has one,\n" +
      "and whether a module reaches the client bundle is a question about imports rather than about\n" +
      "the line.",
  },

  read(cls, context) {
    const found: ServerEnvInSharedCodeIssue[] = [];
    const excused = serverOnlyMembers(cls, context);

    for (const member of cls.members) {
      const name = memberName(member);
      if (name !== undefined && excused.has(name)) continue;
      const visit = (node: ts.Node): void => {
        const read = processEnvRead(node, context);
        if (read !== undefined) {
          /**
           * The whole read, not just `process.env`: `process.env.DATABASE_URL` is what the reader
           * wrote and what they will search for — and `process.env["REGION"]` is too.
           *
           * A destructure keeps `process.env`, which is exactly what is on the right-hand side of
           * it; rewriting that into a dotted form would print text the line does not have.
           */
          const outermost =
            ts.isPropertyAccessExpression(read.parent) ||
            (ts.isElementAccessExpression(read.parent) && ts.isStringLiteralLike(read.parent.argumentExpression))
              ? read.parent
              : read;
          found.push({
            component: context.self.name,
            member: name ?? "(anonymous)",
            read: outermost.getText(),
            ...positionOf(read),
          });
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(member);
    }

    return found;
  },
} as const satisfies Rule<ServerEnvInSharedCodeIssue>;
