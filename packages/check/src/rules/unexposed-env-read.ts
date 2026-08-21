import ts from "typescript";
import { positionOf } from "../syntax";
import { follow, type Looking } from "./follow-value";
import type { ModuleContext, ModuleRule } from "./rule";

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
 * The one shape it cannot read is a key nothing settles — `import.meta.env[whatever]` — which is not
 * judged, for the usual reason.
 *
 * **Both spellings of the read, and a name holding the key.** `import.meta.env["VITE_API_URL"]` is
 * the same read as `import.meta.env.VITE_API_URL` and was silent, and so was a key kept in a
 * `const` — which is what a project with more than two of them does. A branch and a call are not
 * followed: there is no single name to judge behind either.
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

/** The key behind a name — `import.meta.env[KEY]` is the same read, one hop further. */
const KEY_NAME: Looking<string> = {
  leaf: (expression) => (ts.isStringLiteralLike(expression) ? expression.text : undefined),
  throughModuleScope: true,
  throughBranches: false,
  throughCalls: false,
  throughMutableBindings: false,
};

/** Whether this is the `import.meta.env` object itself. */
function isEnvObject(node: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "env" &&
    node.expression.kind === ts.SyntaxKind.MetaProperty
  );
}

/**
 * `import.meta.env.NAME` and `import.meta.env["NAME"]` — one read written two ways.
 *
 * The bracket form was missed entirely, and so was a key held in a `const`. Both reach the same
 * variable in the same build; only the spelling differs.
 */
function envReadName(node: ts.Node, resolve: ModuleContext["resolve"]): { name: string; at: ts.Node } | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return isEnvObject(node.expression) ? { name: node.name.text, at: node.name } : undefined;
  }
  if (!ts.isElementAccessExpression(node) || !isEnvObject(node.expression)) return undefined;

  const key = follow(node.argumentExpression, resolve, KEY_NAME)?.value;
  return key === undefined ? undefined : { name: key, at: node.argumentExpression };
}

export const unexposedEnvRead = {
  id: "unexposed-env-read",

  report: {
    /**
     * A WARNING, and the reason is a premise this rule cannot verify.
     *
     * It is true that the name is never exposed — IF the project uses `@ramonda/build`'s Vite plugin,
     * which is what replaces Vite's `VITE_` prefix. A Ramonda app on plain Vite still exposes `VITE_*`,
     * and for that app every report here would be wrong.
     *
     * `needs: "@ramonda/build"` is the gate for exactly this and cannot be used: `needs` is decided from
     * what the program imports, and the only file importing that package is `vite.config.ts`, which both
     * scaffolded tsconfigs leave out of `include`. So the premise is stated in the message instead of
     * being enforced, and the run is not failed over it.
     */
    severity: "warn",
    reportedWhen:
      "`import.meta.env` is read for a name `@ramonda/build` does not expose, so the value reads `undefined`",
    heading: (found) => `${found.length} environment variable(s) read but never exposed:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    \`import.meta.env.${issue.name}\` is not exposed by Ramonda's build settings, so it reads`,
      `    \`undefined\`. Rename it \`${issue.suggestion}\`, or read it on the server with`,
      `    \`process.env.${issue.name}\`.`,
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
      "are never reported.\n\n" +
      "This assumes you are using `@ramonda/build`'s Vite plugin, which is what replaces Vite's own\n" +
      "`VITE_` prefix. If you configure Vite yourself and left `envPrefix` alone, `VITE_*` still works\n" +
      "and this report does not apply to you — which is why it is a warning and not a failure.",
  },

  read(file, context) {
    const found: UnexposedEnvReadIssue[] = [];

    const visit = (node: ts.Node): void => {
      const read = envReadName(node, context.resolve);
      if (read !== undefined && !BUILT_IN.has(read.name) && !read.name.startsWith(PUBLIC_PREFIX)) {
        found.push({
          name: read.name,
          // `VITE_API_URL` → `RAMONDA_PUBLIC_API_URL`, and `RAMONDA_API_BASE` →
          // `RAMONDA_PUBLIC_API_BASE`. Both old prefixes come off, because keeping one inside the new
          // one produces `RAMONDA_PUBLIC_RAMONDA_API_BASE`, which is a name nobody would accept from a
          // suggestion — and `RAMONDA_` without `PUBLIC` is the case that most reads as if it should
          // already work, so it is the one where the suggestion has to be right.
          suggestion: `${PUBLIC_PREFIX}${read.name.replace(/^(VITE|RAMONDA)_/, "")}`,
          ...positionOf(read.at),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);

    return found;
  },
} as const satisfies ModuleRule<UnexposedEnvReadIssue>;
