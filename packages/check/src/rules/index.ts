import type ts from "typescript";
import type { ModuleContext, ModuleRule, Rule, RuleContext } from "./rule";

export type { ModuleContext, ModuleRule, Rule, RuleContext, RuleSubject } from "./rule";

export { arrowFields, type ArrowFieldIssue } from "./arrow-fields";
export { browserUrl, type BrowserUrlIssue } from "./browser-url";
export { domWrites, type DomWriteIssue } from "./dom-writes";
export { duplicateDecorators, type DuplicateDecoratorIssue } from "./duplicate-decorators";
export { unsplittableImport, type UnsplittableImportIssue } from "./unsplittable-import";
export { unwatchedFields, type UnwatchedFieldIssue } from "./unwatched-fields";

/**
 * A rule paired with the list its findings go into.
 *
 * The analyzer keeps one named array per rule because `AnalyzeResult` publishes them that way, and
 * a rule returns its own issue type — so something has to hold the two together without erasing
 * either. This does, and the two casts are the whole of the untyped surface: they are sound because
 * a `Bound` can only be built by {@link bind}, which sees both halves at once and proves they match.
 */
export interface Bound {
  rule: Rule<unknown>;
  drain(issues: readonly unknown[]): void;
}

export function bind<Issue>(rule: Rule<Issue>, into: Issue[]): Bound {
  return {
    rule: rule as Rule<unknown>,
    drain: (issues) => into.push(...(issues as readonly Issue[])),
  };
}

/** The same pairing for the per-file family. */
export interface BoundModule {
  rule: ModuleRule<unknown>;
  drain(issues: readonly unknown[]): void;
}

export function bindModule<Issue>(rule: ModuleRule<Issue>, into: Issue[]): BoundModule {
  return {
    rule: rule as ModuleRule<unknown>,
    drain: (issues) => into.push(...(issues as readonly Issue[])),
  };
}

/**
 * The rules this project is even running, decided once from what its source imports.
 *
 * A rule with `needs` is not "skipped quietly" — it is not part of the run at all, which is the
 * honest shape: an app with no router is not passing the browser-url rule, it is not being asked the
 * question. Deciding it here rather than inside each rule means the answer is computed once for the
 * whole project instead of once per class, and that a new rule cannot forget to ask.
 */
export function activate<T extends Bound | BoundModule>(all: readonly T[], imported: ReadonlySet<string>): T[] {
  return all.filter(({ rule }) => rule.needs === undefined || imported.has(rule.needs));
}

/**
 * Every active rule over one class.
 *
 * `exempt` is applied here and not in {@link activate} because it is a fact about the CLASS rather
 * than about the project: a rule about reaching past an abstraction is right everywhere except
 * inside the package that implements it, and both of those classes are in the same run.
 */
export function apply(active: readonly Bound[], cls: ts.ClassDeclaration, context: RuleContext): void {
  for (const { rule, drain } of active) {
    if (rule.exempt !== undefined && context.self.id.startsWith(rule.exempt)) continue;
    drain(rule.read(cls, context));
  }
}

/**
 * Every active per-file rule over one source file.
 *
 * The context is built PER RULE rather than handed in ready-made, because the annotation the rule
 * may find has to be recorded against something, and the only honest name for it is the rule that
 * would otherwise have reported the site.
 */
export function applyModule(
  active: readonly BoundModule[],
  file: ts.SourceFile,
  contextFor: (ruleId: string) => ModuleContext,
): void {
  for (const { rule, drain } of active) drain(rule.read(file, contextFor(rule.id)));
}
