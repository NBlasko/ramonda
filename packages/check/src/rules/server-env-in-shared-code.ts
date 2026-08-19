import ts from "typescript";
import { positionOf } from "../syntax";
import { isServerOnly } from "./lifecycle-env";
import type { Rule } from "./rule";

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

/** `process.env` and `process.env.NAME` — the read, however far the property chain goes. */
function processEnvRead(node: ts.Node): ts.Node | undefined {
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  if (node.name.text !== "env") return undefined;
  const target = node.expression;
  return ts.isIdentifier(target) && target.text === "process" ? node : undefined;
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

    for (const member of cls.members) {
      // The one excuse there is. Everything else in a class is somewhere the browser reaches.
      if (isServerOnly(member, context)) continue;
      const name = member.name !== undefined && ts.isIdentifier(member.name) ? member.name.text : "(anonymous)";

      const visit = (node: ts.Node): void => {
        const read = processEnvRead(node);
        if (read !== undefined) {
          // The whole read, not just `process.env`: `process.env.DATABASE_URL` is what the reader
          // wrote and what they will search for.
          const outermost = ts.isPropertyAccessExpression(read.parent) ? read.parent : read;
          found.push({
            component: context.self.name,
            member: name,
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
