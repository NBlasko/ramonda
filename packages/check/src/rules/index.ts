import type ts from "typescript";
import type { ElementRule, JsxElementLike, ModuleContext, ModuleRule, Rule, RuleContext, TreeRule } from "./rule";
import { contextFor } from "./element";
import { treeFor } from "./tree";
import { unnamedImage } from "./unnamed-image";
import { classInsteadOfClassName } from "./class-instead-of-classname";
import { duplicateKeyAmongSiblings } from "./duplicate-key-among-siblings";
import { rowWithoutAKey } from "./row-without-a-key";
import { indexAsKey } from "./index-as-key";
import { interactiveInsideInteractive } from "./interactive-inside-interactive";
import { tagNeedsItsParent } from "./tag-needs-its-parent";
import { unknownAriaAttribute } from "./unknown-aria-attribute";
import { unknownRole } from "./unknown-role";
import { ariaValue } from "./aria-value";
import { roleMissingRequiredAria } from "./role-missing-required-aria";
import { roleTakesNoName } from "./role-takes-no-name";
import { ariaWithNoSubject } from "./aria-with-no-subject";
import { emptyHeadingOrLink } from "./empty-heading-or-link";
import { unnamedFrame } from "./unnamed-frame";
import { positiveTabIndex } from "./positive-tabindex";
import { linkWithoutADestination } from "./link-without-a-destination";
import { freshObjectInProps } from "./fresh-object-in-props";
import { clickWithNoKeyboardPath } from "./click-with-no-keyboard-path";
import { accessKey } from "./access-key";
import { mediaWithNoCaptions } from "./media-with-no-captions";
import { ariaHiddenOnFocusable } from "./aria-hidden-on-focusable";
import { arrowFields } from "./arrow-fields";
import { clockReadWhileRendering } from "./clock-read-while-rendering";
import { stateWrittenWhileRendering } from "./state-written-while-rendering";
import { asyncRender } from "./async-render";
import { computeReadsAPlainField } from "./compute-reads-a-plain-field";
import { watchOfAPropThatIsNotThere } from "./watch-of-a-prop-that-is-not-there";
import { browserUrl } from "./browser-url";
import { domWrites } from "./dom-writes";
import { duplicateDecorators } from "./duplicate-decorators";
import { unsplittableImport } from "./unsplittable-import";
import { unwatchedFields } from "./unwatched-fields";
import { persistOfALossyValue } from "./persist-of-a-lossy-value";
import { lateRequestRead } from "./late-request-read";
import { headTagsCollide } from "./head-tags-collide";
import { unguardedAsyncLifecycle } from "./unguarded-async-lifecycle";
import { duplicateId } from "./duplicate-id";
import { headingSkipsALevel } from "./heading-skips-a-level";
import { contextConsumedAboveItsProvider } from "./context-consumed-above-its-provider";
import { clientOnlyRequestRead } from "./client-only-request-read";

export type {
  ElementContext,
  ElementRule,
  JsxElementLike,
  ModuleContext,
  ModuleRule,
  Report,
  Rule,
  RuleContext,
  RuleSubject,
  TreeContext,
  TreeNode,
  TreeRule,
} from "./rule";

export { unnamedImage, type UnnamedImageIssue } from "./unnamed-image";
export { classInsteadOfClassName, type ClassInsteadOfClassNameIssue } from "./class-instead-of-classname";
export { duplicateKeyAmongSiblings, type DuplicateKeyAmongSiblingsIssue } from "./duplicate-key-among-siblings";
export { rowWithoutAKey, type RowWithoutAKeyIssue } from "./row-without-a-key";
export { indexAsKey, type IndexAsKeyIssue } from "./index-as-key";
export { interactiveInsideInteractive, type InteractiveInsideInteractiveIssue } from "./interactive-inside-interactive";
export { tagNeedsItsParent, type TagNeedsItsParentIssue } from "./tag-needs-its-parent";
export { NEEDS_PARENT, NOT_INSIDE_ITSELF } from "./html";
export { unknownAriaAttribute, type UnknownAriaAttributeIssue } from "./unknown-aria-attribute";
export { unknownRole, type UnknownRoleIssue } from "./unknown-role";
export { ariaWithNoSubject, type AriaWithNoSubjectIssue } from "./aria-with-no-subject";
export {
  ABSTRACT_ROLES,
  ARIA_ATTRIBUTES,
  ARIA_VALUES,
  NAME_PROHIBITED,
  NAME_PROHIBITED_TAGS,
  NO_ARIA,
  ROLE_REQUIRES,
  ROLES,
  STATE_FROM_THE_ELEMENT,
} from "./aria";
export type { AriaValue, AriaValueKind } from "./aria";
export { ariaValue, type AriaValueIssue } from "./aria-value";
export { roleMissingRequiredAria, type RoleMissingRequiredAriaIssue } from "./role-missing-required-aria";
export { roleTakesNoName, type RoleTakesNoNameIssue } from "./role-takes-no-name";
export { emptyHeadingOrLink, type EmptyHeadingOrLinkIssue } from "./empty-heading-or-link";
export { unnamedFrame, type UnnamedFrameIssue } from "./unnamed-frame";
export { positiveTabIndex, type PositiveTabIndexIssue } from "./positive-tabindex";
export { linkWithoutADestination, type LinkWithoutADestinationIssue } from "./link-without-a-destination";
export { freshObjectInProps, type FreshObjectInPropsIssue } from "./fresh-object-in-props";
export { clickWithNoKeyboardPath, type ClickWithNoKeyboardPathIssue } from "./click-with-no-keyboard-path";
export { accessKey, type AccessKeyIssue } from "./access-key";
export { mediaWithNoCaptions, type MediaWithNoCaptionsIssue } from "./media-with-no-captions";
export { ariaHiddenOnFocusable, type AriaHiddenOnFocusableIssue } from "./aria-hidden-on-focusable";

export { arrowFields, type ArrowFieldIssue } from "./arrow-fields";
export { asyncRender, type AsyncRenderIssue } from "./async-render";
export { computeReadsAPlainField, type ComputeReadsAPlainFieldIssue } from "./compute-reads-a-plain-field";
export { watchOfAPropThatIsNotThere, type WatchOfAPropThatIsNotThereIssue } from "./watch-of-a-prop-that-is-not-there";
export { clockReadWhileRendering, type ClockReadWhileRenderingIssue } from "./clock-read-while-rendering";
export { stateWrittenWhileRendering, type StateWrittenWhileRenderingIssue } from "./state-written-while-rendering";
export { browserUrl, type BrowserUrlIssue } from "./browser-url";
export { domWrites, type DomWriteIssue } from "./dom-writes";
export { duplicateDecorators, type DuplicateDecoratorIssue } from "./duplicate-decorators";
export { unsplittableImport, type UnsplittableImportIssue } from "./unsplittable-import";
export { unwatchedFields, type UnwatchedFieldIssue } from "./unwatched-fields";
export { persistOfALossyValue, type PersistOfALossyValueIssue } from "./persist-of-a-lossy-value";
export { lateRequestRead, type LateRequestReadIssue } from "./late-request-read";
export { headTagsCollide, type HeadTagsCollideIssue } from "./head-tags-collide";
export { unguardedAsyncLifecycle, type UnguardedAsyncLifecycleIssue } from "./unguarded-async-lifecycle";
export { duplicateId, type DuplicateIdIssue } from "./duplicate-id";
export { headingSkipsALevel, type HeadingSkipsALevelIssue } from "./heading-skips-a-level";
export { clientOnlyRequestRead, type ClientOnlyRequestReadIssue } from "./client-only-request-read";
export {
  contextConsumedAboveItsProvider,
  type ContextConsumedAboveItsProviderIssue,
} from "./context-consumed-above-its-provider";
export { rootsIn, treeFor } from "./tree";

/**
 * Every rule that reads a CLASS, in the order their sections are printed.
 *
 * A tuple rather than an array, and `as const` rather than an annotation, because both are
 * load-bearing: the ids stay literal, and {@link Findings} below is derived from them. Annotate
 * this `Rule<unknown>[]` and every id collapses to `string`, the findings type collapses with it,
 * and the whole arrangement quietly becomes a `Record<string, unknown[]>` that compiles.
 */
export const CLASS_RULES = [
  asyncRender,
  stateWrittenWhileRendering,
  clockReadWhileRendering,
  computeReadsAPlainField,
  arrowFields,
  browserUrl,
  domWrites,
  duplicateDecorators,
  unwatchedFields,
  watchOfAPropThatIsNotThere,
  persistOfALossyValue,
  lateRequestRead,
  headTagsCollide,
  unguardedAsyncLifecycle,
  contextConsumedAboveItsProvider,
  clientOnlyRequestRead,
] as const;

/** Every rule that reads a FILE. Same arrangement, different subject. */
export const MODULE_RULES = [unsplittableImport] as const;

/**
 * Every rule that reads one JSX ELEMENT — where accessibility lives.
 *
 * The order here is the order their sections print in, which is why the two about a missing NAME
 * sit together: a reader fixing one is usually about to fix the other.
 */
export const ELEMENT_RULES = [
  duplicateKeyAmongSiblings,
  rowWithoutAKey,
  indexAsKey,
  classInsteadOfClassName,
  tagNeedsItsParent,
  interactiveInsideInteractive,
  unnamedImage,
  unknownAriaAttribute,
  unknownRole,
  roleMissingRequiredAria,
  roleTakesNoName,
  ariaValue,
  ariaWithNoSubject,
  emptyHeadingOrLink,
  unnamedFrame,
  positiveTabIndex,
  ariaHiddenOnFocusable,
  linkWithoutADestination,
  freshObjectInProps,
  clickWithNoKeyboardPath,
  accessKey,
  mediaWithNoCaptions,
] as const;

/**
 * Every rule that reads one RENDER — the whole markup tree, in document order.
 *
 * The fourth family. What it answers that the element family cannot is anything about two elements
 * meeting each other: two ids that are the same, a heading level that jumps. Those need a subject
 * the size of a render, and the guard they all need — whether an element is really on the page at
 * all — is computed once for them in `tree.ts`.
 */
export const TREE_RULES = [duplicateId, headingSkipsALevel] as const;

/** All four families, which is what the CLI prints from and what {@link Findings} is keyed by. */
export const RULES = [...CLASS_RULES, ...MODULE_RULES, ...ELEMENT_RULES, ...TREE_RULES] as const;

export type AnyRule = (typeof RULES)[number];

/** The issue type a rule produces, read off the rule rather than written down twice. */
type IssueOf<R> =
  R extends Rule<infer Issue>
    ? Issue
    : R extends ModuleRule<infer Issue>
      ? Issue
      : R extends ElementRule<infer Issue>
        ? Issue
        : R extends TreeRule<infer Issue>
          ? Issue
          : never;

/**
 * What every rule found, keyed by its id and typed as that rule's own issue.
 *
 * This replaced one named field per rule on `AnalyzeResult`. The field was fine at five rules and
 * is not at the number this package is heading for: each one is a line in the published interface,
 * a line in the CLI's destructure, and a clause in the sentence that says everything is fine. Here,
 * adding a rule adds a member to this type by adding it to the tuple above, and nothing else.
 *
 * It is a mapped type rather than a hand-written interface for the same reason the ids are literal:
 * a hand-written one is a second list to keep in step, and this whole package exists because those
 * drift.
 */
export type Findings = {
  [R in AnyRule as R["id"]]: IssueOf<R>[];
};

/**
 * The rules that FAILED this run — the ones with `severity: "error"` that found something.
 *
 * Here rather than in `cli.ts` because it is a fact about the rules, and because it is the one
 * piece of the command that must not be got wrong quietly. It was a list written by hand, a clause
 * per rule inside the condition that prints "everything is fine": a rule added without its clause
 * makes that line print directly above its own report, and the run exits 0 with a real fault in it.
 *
 * Demonstrated rather than argued: with this replaced by an empty list, `fixtures/only-a-rule` — a
 * project whose single fault is a doubled decorator — prints the all-clear and exits 0, and the
 * report is never reached because the all-clear exits first.
 */
export function failingRules(findings: Findings): AnyRule[] {
  return RULES.filter((rule) => rule.report.severity === "error" && findings[rule.id].length > 0);
}

/**
 * One rule, as something that is not this package needs to describe it.
 *
 * The documentation site is the consumer this exists for: its reference page used to carry two
 * tables of these typed by hand, and they went stale the day new rules landed beside them. A
 * summary is now READ from the rules, so the page cannot list a rule that does not exist or miss
 * one that does.
 *
 * Deliberately not the rule itself. A rule carries functions over its own issue type, which is of
 * no use to a generator and would tie anything that touched it to this package's internals; this
 * is four strings.
 */
export interface RuleSummary {
  /** The id, which is also the key in `findings`. */
  id: string;
  /** `error` fails a run; `warn` prints and lets it through. */
  severity: "warn" | "error";
  /** The condition, as a clause completing "reported when". */
  reportedWhen: string;
  /** The runtime diagnostic reporting the same fault, for the rules that have one. */
  alsoReportedAs?: string;
}

/**
 * Every rule this package runs, in the order their reports are printed.
 *
 * Order is part of the answer rather than incidental: it is the order a reader meets the sections
 * in, so a generated table that sorted them would disagree with the command.
 */
export function ruleCatalogue(): RuleSummary[] {
  return RULES.map((rule) => ({
    id: rule.id,
    severity: rule.report.severity,
    reportedWhen: rule.report.reportedWhen,
    ...("alsoReportedAs" in rule.report && rule.report.alsoReportedAs !== undefined
      ? { alsoReportedAs: rule.report.alsoReportedAs as string }
      : {}),
  }));
}

/** An empty finding list per rule, for the analyzer to fill. */
export function emptyFindings(): Findings {
  // `fromEntries` answers `{ [k: string]: never[] }` — it cannot know the keys are exactly the ids,
  // and the tuple above is what knows. The hop through `unknown` says so out loud rather than
  // pretending the two types overlap.
  return Object.fromEntries(RULES.map((rule) => [rule.id, []])) as unknown as Findings;
}

/**
 * The rules this project is even running, decided once from what its source imports.
 *
 * A rule with `needs` is not "skipped quietly" — it is not part of the run at all, which is the
 * honest shape: an app with no router is not passing the browser-url rule, it is not being asked
 * the question. Deciding it here rather than inside each rule means the answer is computed once for
 * the whole project instead of once per class, and that a new rule cannot forget to ask.
 */
export function activate<R extends { id: string }>(all: readonly R[], imported: ReadonlySet<string>): R[] {
  // `"needs" in rule` rather than `rule.needs`: these are the rules' own inferred types, and a rule
  // that declares no `needs` has no such property to read. Narrowing asks the question the optional
  // field was meant to ask, without widening every rule to `Rule<unknown>` and losing its id.
  return all.filter((rule) => !("needs" in rule) || rule.needs === undefined || imported.has(rule.needs as string));
}

/**
 * Pushes what a rule found into its own list.
 *
 * The one cast in the file. `findings[rule.id]` is a union of every rule's array type, because
 * `rule` is a union of every rule — so nothing can be pushed into it without saying, once, that the
 * pair came from the same rule. It did: both sides are read from the same object.
 */
function collect(findings: Findings, rule: AnyRule, issues: readonly unknown[]): void {
  (findings[rule.id] as unknown[]).push(...issues);
}

/**
 * Every active per-class rule over one class.
 *
 * `exempt` is applied here and not in {@link activate} because it is a fact about the CLASS rather
 * than about the project: a rule about reaching past an abstraction is right everywhere except
 * inside the package that implements it, and both of those classes are in the same run.
 */
export function applyClass(
  active: readonly (typeof CLASS_RULES)[number][],
  cls: ts.ClassDeclaration,
  context: RuleContext,
  findings: Findings,
): void {
  for (const rule of active) {
    // Same narrowing as `activate` uses for `needs`, and for the same reason.
    const exempt = "exempt" in rule ? (rule.exempt as string) : undefined;
    if (exempt !== undefined && context.self.id.startsWith(exempt)) continue;
    collect(findings, rule, rule.read(cls, context));
  }
}

/**
 * Every active per-file rule over one source file.
 *
 * The context is built PER RULE rather than handed in ready-made, because the annotation the rule
 * may find has to be recorded against something, and the only honest name for it is the rule that
 * would otherwise have reported the site.
 */
/**
 * Every active element rule over one JSX element.
 *
 * **A spreading element is handed to nobody.** `<img {...rest} />` may carry the very attribute a
 * rule is about, and nothing static can say whether it does — so the silence contract applies to
 * the whole family at once, here, rather than being remembered by each of forty rules. It is the
 * same argument as `needs` and `exempt`: a guard every rule needs is a guard a rule can forget.
 *
 * The context is built ONCE and shared. Forty rules asking "is there an `alt`" would otherwise walk
 * the same attribute list forty times.
 */
export function applyElement(
  active: readonly (typeof ELEMENT_RULES)[number][],
  element: JsxElementLike,
  findings: Findings,
): void {
  const context = contextFor(element);
  if (context.spreads) return;
  for (const rule of active) collect(findings, rule, rule.read(element, context));
}

export function applyModule(
  active: readonly (typeof MODULE_RULES)[number][],
  file: ts.SourceFile,
  contextFor: (ruleId: string) => ModuleContext,
  findings: Findings,
): void {
  for (const rule of active) collect(findings, rule, rule.read(file, contextFor(rule.id)));
}

/**
 * Every active tree rule over one render.
 *
 * The context is built ONCE and shared, as it is for elements — and it costs more to build here,
 * because it walks the whole tree and decides for every element whether it is really on the page.
 * A rule doing that itself would be doing it again for every other rule in the family.
 */
export function applyTree(active: readonly (typeof TREE_RULES)[number][], root: ts.Node, findings: Findings): void {
  if (active.length === 0) return;
  const tree = treeFor(root);
  for (const rule of active) collect(findings, rule, rule.read(tree));
}
