import ts from "typescript";
import { decoratorName } from "../syntax";
import { importedFromCore } from "./core-import";
import type { RuleContext } from "./rule";

/**
 * Which side of the wire a class member runs on, read off its decorators.
 *
 * Shared rather than copied because two rules now turn on it and they ask OPPOSITE questions of the
 * same facts: `client-only-request-read` wants members that cannot run on the server, and
 * `server-env-in-shared-code` wants members that cannot run in the browser. One set of facts, so one
 * place to be right about them.
 *
 * Every entry here is read off the framework rather than assumed, and each has a mechanism behind it —
 * see {@link CLIENT_ONLY_DECORATORS}.
 */

/**
 * Decorators that put a member in the browser and nowhere else, and what to call each one in a report.
 *
 * `@updated` is skipped for `env === "server"` in core's `flushUpdated`; the timers and the listener
 * decorators are built on `createSubscriptionDecorator`, which attaches an EFFECT, and
 * `runComponentEffects` returns immediately on the server; `@deferHydration` belongs to hydration,
 * which only ever happens in a browser.
 */
export const CLIENT_ONLY_DECORATORS = new Map<string, string>([
  ["updated", "`@updated` runs after a commit, and the commit skips a server render"],
  ["deferHydration", "`@deferHydration` belongs to hydration, which only happens in a browser"],
  ["interval", "`@interval` is an effect, and effects never run on the server"],
  ["timeout", "`@timeout` is an effect, and effects never run on the server"],
  ["onWindow", "`@onWindow` is an effect, and effects never run on the server"],
  ["onDocument", "`@onDocument` is an effect, and effects never run on the server"],
  ["onElement", "`@onElement` is an effect, and effects never run on the server"],
]);

/** The lifecycle decorators, which run on BOTH sides unless the call says otherwise. */
export const LIFECYCLE_DECORATORS = new Set(["created", "mounted", "destroyed"]);

/** `{ env: "client" }` on a lifecycle decorator, which is what narrows it to one side. */
function envOf(decorator: ts.Decorator): string | undefined {
  if (!ts.isCallExpression(decorator.expression)) return undefined;
  const options = decorator.expression.arguments[0];
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return undefined;
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name;
    const named = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
    if (named !== "env") continue;
    const value = property.initializer;
    return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : undefined;
  }
  return undefined;
}

/**
 * Core's decorators on this member, ignoring anything an app happens to have named the same.
 *
 * The import check is the point: an app is entitled to its own `@interval`, and judging code under one
 * would be reporting the reader's own decorator for the framework's rule.
 *
 * `ts.getDecorators` wants a node the compiler already knows can carry them, and `ClassElement` is the
 * union including the ones that cannot — so the two that can are asked and the rest read as bare.
 */
function coreDecorators(member: ts.ClassElement, context: RuleContext): ts.Decorator[] {
  const decorated = ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member) ? member : undefined;
  const all = (decorated === undefined ? undefined : ts.getDecorators(decorated)) ?? [];
  return all.filter((decorator) => {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression
      : decorator.expression;
    return importedFromCore(expression, context.resolveLocal);
  });
}

/**
 * Why this member cannot run on the server, or `undefined` when it can — which includes not knowing.
 */
export function clientOnlyBecause(member: ts.ClassElement, context: RuleContext): string | undefined {
  for (const decorator of coreDecorators(member, context)) {
    const name = decoratorName(decorator);
    if (name === undefined) continue;

    const known = CLIENT_ONLY_DECORATORS.get(name);
    if (known !== undefined) return known;

    if (LIFECYCLE_DECORATORS.has(name) && envOf(decorator) === "client") {
      return `\`@${name}({ env: "client" })\` says so itself`;
    }
  }
  return undefined;
}

/**
 * Whether this member is explicitly SERVER-only, which is the only way a member cannot reach a browser.
 *
 * Nothing else counts, and that is the whole asymmetry between this and {@link clientOnlyBecause}:
 * `render()` runs on both sides, a field initializer runs on both sides, and `@created` / `@mounted` /
 * `@destroyed` default to `shared`. So "not marked" means "the browser gets here too", and a member has
 * to say `{ env: "server" }` to be excused.
 */
export function isServerOnly(member: ts.ClassElement, context: RuleContext): boolean {
  for (const decorator of coreDecorators(member, context)) {
    const name = decoratorName(decorator);
    if (name !== undefined && LIFECYCLE_DECORATORS.has(name) && envOf(decorator) === "server") return true;
  }
  return false;
}
