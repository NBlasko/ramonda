import ts from "typescript";
import { positionOf } from "../syntax";
import type { ModuleRule } from "./rule";

/**
 * An `import.meta.env` name that nothing will ever expose.
 *
 * Ramonda's build settings expose exactly one prefix — `RAMONDA_PUBLIC_` — plus the five names the
 * bundler provides itself. Every other name reads `undefined` in the browser, and nothing says so:
 * the build succeeds, the value is missing, and the failure is whatever the app does with `undefined`
 * three layers later.
 *
 * ## Why this is worth a rule rather than a note
 *
 * Because it is the migration hazard, measured. Vite's `envPrefix` REPLACES its default rather than
 * adding to it, so adopting `@ramonda/build`'s Vite plugin makes every `VITE_*` read stop working —
 * in `build` and in `dev`, verified. An app moving to Ramonda has exactly this shape of code, and the
 * symptom is a variable that quietly became `undefined`.
 *
 * ## Why it is COMPLETE, unlike most rules about a value
 *
 * It asks nothing about where a value came from or whether one was set. It reads the NAME, which is
 * written on the spot in `import.meta.env.NAME`, and asks whether that name is in the exposed set.
 * The exposed set is a fact about the prefix, not about the machine — so the answer does not depend on
 * an environment, a `.env` file, or who is running the build. Nothing here can go quiet for a path it
 * could not resolve, because there is nothing to resolve.
 *
 * The one shape it cannot read is a computed key — `import.meta.env[name]` — which is not judged,
 * for the usual reason.
 */
export interface UnexposedEnvReadIssue {
  /** The name as written — `VITE_API_URL`, `API_BASE`. */
  name: string;
  /** What it should have been called, when the fix is only a prefix away. */
  suggestion: string;
  file: string;
  line: number;
  column: number;
}

/** The prefix `@ramonda/build` exposes. Kept as a literal rather than imported: this package does not depend on that one. */
const PUBLIC_PREFIX = "RAMONDA_PUBLIC_";

/**
 * The names a bundler provides itself, which are exposed whatever the prefix is.
 *
 * Read off Vite's injected object rather than guessed — measured in a dev transform, which emits
 * `import.meta.env = {"BASE_URL": …, "DEV": …, "MODE": …, "PROD": …, "SSR": …}`.
 */
const BUILT_IN = new Set(["BASE_URL", "DEV", "MODE", "PROD", "SSR", "LEGACY"]);

/** `import.meta.env.NAME` — the whole shape, and only when the name is written out. */
function envReadName(node: ts.Node): { name: string; at: ts.Node } | undefined {
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  const inner = node.expression;
  if (!ts.isPropertyAccessExpression(inner) || inner.name.text !== "env") return undefined;
  if (inner.expression.kind !== ts.SyntaxKind.MetaProperty) return undefined;
  return { name: node.name.text, at: node.name };
}

export const unexposedEnvRead = {
  id: "unexposed-env-read",

  report: {
    // An ERROR rather than the usual warning-first, for the same reason `one-provider-per-component`
    // is one: the value is not merely suspect, it is `undefined` — and unlike a throw, nothing at
    // runtime will ever tell you.
    severity: "error",
    reportedWhen: "`import.meta.env` is read for a name no build exposes, so the value is always `undefined`",
    heading: (found) => `${found.length} environment variable(s) read but never exposed:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    \`import.meta.env.${issue.name}\` is always \`undefined\` — nothing exposes that name.`,
      `    Rename it \`${issue.suggestion}\`, or read it on the server with \`process.env.${issue.name}\`.`,
    ],
    advice:
      "A variable reaches the browser only when its name says so. `@ramonda/build` exposes the\n" +
      "`RAMONDA_PUBLIC_` prefix and nothing else, because the prefix IS the decision to publish —\n" +
      "otherwise adding a line to a `.env` would be one keystroke away from shipping a secret.\n\n" +
      "So there are two places to read a variable, and the name says which:\n\n" +
      "    process.env.DATABASE_URL                    // server only, named however your host names it\n" +
      "    import.meta.env.RAMONDA_PUBLIC_API_BASE     // compiled into the bundle, readable by anyone\n\n" +
      "**If you are coming from Vite, this is the one that catches you.** `envPrefix` REPLACES Vite's\n" +
      "default rather than adding to it, so `VITE_*` is no longer exposed — measured, in `build` and in\n" +
      "`dev`. Rename the variable, or read it on the server and pass the value down.\n\n" +
      "The bundler's own names — `DEV`, `PROD`, `MODE`, `SSR`, `BASE_URL` — are always available and\n" +
      "are never reported.",
  },

  read(file, context) {
    const found: UnexposedEnvReadIssue[] = [];

    const visit = (node: ts.Node): void => {
      const read = envReadName(node);
      if (read !== undefined && !BUILT_IN.has(read.name) && !read.name.startsWith(PUBLIC_PREFIX)) {
        const issue = context.unlessAnnotated(read.at, () => ({
          name: read.name,
          // `VITE_API_URL` → `RAMONDA_PUBLIC_API_URL`, and `RAMONDA_API_BASE` →
          // `RAMONDA_PUBLIC_API_BASE`. Both old prefixes come off, because keeping one inside the new
          // one produces `RAMONDA_PUBLIC_RAMONDA_API_BASE`, which is a name nobody would accept from a
          // suggestion — and `RAMONDA_` without `PUBLIC` is the case that most reads as if it should
          // already work, so it is the one where the suggestion has to be right.
          suggestion: `${PUBLIC_PREFIX}${read.name.replace(/^(VITE|RAMONDA)_/, "")}`,
          ...positionOf(read.at),
        }));
        if (issue !== undefined) found.push(issue);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);

    return found;
  },
} as const satisfies ModuleRule<UnexposedEnvReadIssue>;
