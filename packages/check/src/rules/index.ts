import type ts from "typescript";
import type {
  ElementRule,
  JsxElementLike,
  ModuleContext,
  ModuleRule,
  ProjectContext,
  ProjectRule,
  Rule,
  RuleContext,
  TreeRule,
  ElementContext,
  Silencer,
} from "./rule";
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
import { freshObjectInHookProps } from "./fresh-object-in-hook-props";
import { freshValueFromAWatchSelector } from "./fresh-value-from-a-watch-selector";
import { freshObjectInProps } from "./fresh-object-in-props";
import { functionUsedAsATag } from "./function-used-as-a-tag";
import { objectAmongTheChildren } from "./object-among-the-children";
import { propsWrittenByTheReceiver } from "./props-written-by-the-receiver";
import { lazyImportsThatCollide } from "./lazy-imports-that-collide";
import { functionBuiltInTheMarkup } from "./function-built-in-the-markup";
import { clickWithNoKeyboardPath } from "./click-with-no-keyboard-path";
import { accessKey } from "./access-key";
import { attributeThatDoesNothing } from "./attribute-that-does-nothing";
import { mediaWithNoCaptions } from "./media-with-no-captions";
import { fragmentLinkToNowhere } from "./fragment-link-to-nowhere";
import { referenceToAnIdThatIsNotThere } from "./reference-to-an-id-that-is-not-there";
import { controlWithNoLabel } from "./control-with-no-label";
import { namedOnlyByAPlaceholder } from "./named-only-by-a-placeholder";
import { ariaHiddenOnFocusable } from "./aria-hidden-on-focusable";
import { presentationRoleOnFocusable } from "./presentation-role-on-focusable";
import { ariaStateWithNoRole } from "./aria-state-with-no-role";
import { autocompleteThatFillsNothing } from "./autocomplete-that-fills-nothing";
import { moreThanOneMain } from "./more-than-one-main";
import { labelThatNamesNothing } from "./label-that-names-nothing";
import { ariaStateTheRoleDoesNotHave } from "./aria-state-the-role-does-not-have";
import { ariaHiddenAroundSomethingFocusable } from "./aria-hidden-around-something-focusable";
import { tableWithNoHeaders } from "./table-with-no-headers";
import { landmarksThatCannotBeToldApart } from "./landmarks-that-cannot-be-told-apart";
import { regionWithNoName } from "./region-with-no-name";
import { falseOnABooleanAttribute } from "./false-on-a-boolean-attribute";
import { misspelledElementProperty } from "./misspelled-element-property";
import { halfBuiltKeyboardPath } from "./half-built-keyboard-path";
import { elementHtmlRemoved } from "./element-html-removed";
import { optionThatCannotChoose } from "./option-that-cannot-choose";
import { parentWithAForeignChild } from "./parent-with-a-foreign-child";
import { ariaThatContradictsTheTag } from "./aria-that-contradicts-the-tag";
import { roleThatFightsTheTag } from "./role-that-fights-the-tag";
import { liveRegionThatContradictsItsRole } from "./live-region-that-contradicts-its-role";
import { arrowFields } from "./arrow-fields";
import { clockReadWhileRendering } from "./clock-read-while-rendering";
import { stateWrittenWhileRendering } from "./state-written-while-rendering";
import { stateMutatedInPlace } from "./state-mutated-in-place";
import { decoratorThatAddsNothing } from "./decorator-that-adds-nothing";
import { devGuardAsAnExpression } from "./dev-guard-as-an-expression";
import { unkeyableMemoizedArgument } from "./unkeyable-memoized-argument";
import { asyncRender } from "./async-render";
import { computeTakesNoArguments } from "./compute-takes-no-arguments";
import { cachedReadOfAPlainField } from "./cached-read-of-a-plain-field";
import { watchOfAPropThatIsNotThere } from "./watch-of-a-prop-that-is-not-there";
import { browserUrl } from "./browser-url";
import { domWrites } from "./dom-writes";
import { duplicateDecorators } from "./duplicate-decorators";
import { unsplittableImport } from "./unsplittable-import";
import { unwatchedFields } from "./unwatched-fields";
import { persistOfALossyValue } from "./persist-of-a-lossy-value";
import { unserializableState } from "./unserializable-state";
import { intervalWithNoCleanup } from "./interval-with-no-cleanup";
import { listenerAddedByHand } from "./listener-added-by-hand";
import { lateRequestRead } from "./late-request-read";
import { headTagsCollide } from "./head-tags-collide";
import { unguardedAsyncLifecycle } from "./unguarded-async-lifecycle";
import { duplicateId } from "./duplicate-id";
import { headingSkipsALevel } from "./heading-skips-a-level";
import { contextConsumedAboveItsProvider } from "./context-consumed-above-its-provider";
import { clientOnlyRequestRead } from "./client-only-request-read";
import { oneProviderPerComponent } from "./one-provider-per-component";
import { unexposedEnvRead } from "./unexposed-env-read";
import { rowReadsAPlainField } from "./row-reads-a-plain-field";
import { serverEnvInSharedCode } from "./server-env-in-shared-code";

export type {
  ElementContext,
  FormControl,
  IdReference,
  ProjectContext,
  ProjectRule,
  UnreadableId,
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
export { freshObjectInHookProps, type FreshObjectInHookPropsIssue } from "./fresh-object-in-hook-props";
export {
  freshValueFromAWatchSelector,
  type FreshValueFromAWatchSelectorIssue,
} from "./fresh-value-from-a-watch-selector";
export { freshObjectInProps, type FreshObjectInPropsIssue } from "./fresh-object-in-props";
export { functionUsedAsATag, type FunctionUsedAsATagIssue } from "./function-used-as-a-tag";
export {
  objectAmongTheChildren,
  type ObjectAmongTheChildrenIssue,
} from "./object-among-the-children";
export {
  propsWrittenByTheReceiver,
  type PropsWrittenByTheReceiverIssue,
} from "./props-written-by-the-receiver";
export {
  lazyImportsThatCollide,
  type LazyImportsThatCollideIssue,
} from "./lazy-imports-that-collide";
export {
  functionBuiltInTheMarkup,
  type FunctionBuiltInTheMarkupIssue,
} from "./function-built-in-the-markup";
export { clickWithNoKeyboardPath, type ClickWithNoKeyboardPathIssue } from "./click-with-no-keyboard-path";
export { accessKey, type AccessKeyIssue } from "./access-key";
export { attributeThatDoesNothing, type AttributeThatDoesNothingIssue } from "./attribute-that-does-nothing";
export { mediaWithNoCaptions, type MediaWithNoCaptionsIssue } from "./media-with-no-captions";
export { fragmentLinkToNowhere, type FragmentLinkToNowhereIssue } from "./fragment-link-to-nowhere";
export {
  referenceToAnIdThatIsNotThere,
  type ReferenceToAnIdThatIsNotThereIssue,
} from "./reference-to-an-id-that-is-not-there";
export { controlWithNoLabel, type ControlWithNoLabelIssue } from "./control-with-no-label";
export { namedOnlyByAPlaceholder, type NamedOnlyByAPlaceholderIssue } from "./named-only-by-a-placeholder";
export { couldExist, idTableFor, NAMES_AN_ID } from "./idTable";
export { ariaHiddenOnFocusable, type AriaHiddenOnFocusableIssue } from "./aria-hidden-on-focusable";
export {
  presentationRoleOnFocusable,
  type PresentationRoleOnFocusableIssue,
} from "./presentation-role-on-focusable";
export { ariaStateWithNoRole, type AriaStateWithNoRoleIssue } from "./aria-state-with-no-role";
export {
  autocompleteThatFillsNothing,
  type AutocompleteThatFillsNothingIssue,
} from "./autocomplete-that-fills-nothing";
export { moreThanOneMain, type MoreThanOneMainIssue } from "./more-than-one-main";
export { labelThatNamesNothing, type LabelThatNamesNothingIssue } from "./label-that-names-nothing";
export {
  ariaStateTheRoleDoesNotHave,
  type AriaStateTheRoleDoesNotHaveIssue,
} from "./aria-state-the-role-does-not-have";
export {
  ariaHiddenAroundSomethingFocusable,
  type AriaHiddenAroundSomethingFocusableIssue,
} from "./aria-hidden-around-something-focusable";
export { tableWithNoHeaders, type TableWithNoHeadersIssue } from "./table-with-no-headers";
export {
  landmarksThatCannotBeToldApart,
  type LandmarksThatCannotBeToldApartIssue,
} from "./landmarks-that-cannot-be-told-apart";
export { regionWithNoName, type RegionWithNoNameIssue } from "./region-with-no-name";
export { falseOnABooleanAttribute, type FalseOnABooleanAttributeIssue } from "./false-on-a-boolean-attribute";
export { misspelledElementProperty, type MisspelledElementPropertyIssue } from "./misspelled-element-property";
export { halfBuiltKeyboardPath, type HalfBuiltKeyboardPathIssue } from "./half-built-keyboard-path";
export { elementHtmlRemoved, type ElementHtmlRemovedIssue } from "./element-html-removed";
export { optionThatCannotChoose, type OptionThatCannotChooseIssue } from "./option-that-cannot-choose";
export { parentWithAForeignChild, type ParentWithAForeignChildIssue } from "./parent-with-a-foreign-child";
export {
  ariaThatContradictsTheTag,
  type AriaThatContradictsTheTagIssue,
} from "./aria-that-contradicts-the-tag";
export { roleThatFightsTheTag, type RoleThatFightsTheTagIssue } from "./role-that-fights-the-tag";
export {
  liveRegionThatContradictsItsRole,
  type LiveRegionThatContradictsItsRoleIssue,
} from "./live-region-that-contradicts-its-role";

export { arrowFields, type ArrowFieldIssue } from "./arrow-fields";
export { asyncRender, type AsyncRenderIssue } from "./async-render";
export { cachedReadOfAPlainField, type CachedReadOfAPlainFieldIssue } from "./cached-read-of-a-plain-field";
export { watchOfAPropThatIsNotThere, type WatchOfAPropThatIsNotThereIssue } from "./watch-of-a-prop-that-is-not-there";
export { clockReadWhileRendering, type ClockReadWhileRenderingIssue } from "./clock-read-while-rendering";
export { stateWrittenWhileRendering, type StateWrittenWhileRenderingIssue } from "./state-written-while-rendering";
export { stateMutatedInPlace, type StateMutatedInPlaceIssue } from "./state-mutated-in-place";
export { decoratorThatAddsNothing, type DecoratorThatAddsNothingIssue } from "./decorator-that-adds-nothing";
export { devGuardAsAnExpression, type DevGuardAsAnExpressionIssue } from "./dev-guard-as-an-expression";
export { unkeyableMemoizedArgument, type UnkeyableMemoizedArgumentIssue } from "./unkeyable-memoized-argument";
export { browserUrl, type BrowserUrlIssue } from "./browser-url";
export { domWrites, type DomWriteIssue } from "./dom-writes";
export { duplicateDecorators, type DuplicateDecoratorIssue } from "./duplicate-decorators";
export { unsplittableImport, type UnsplittableImportIssue } from "./unsplittable-import";
export { unwatchedFields, type UnwatchedFieldIssue } from "./unwatched-fields";
export { persistOfALossyValue, type PersistOfALossyValueIssue } from "./persist-of-a-lossy-value";
export { unserializableState, type UnserializableStateIssue } from "./unserializable-state";
export { intervalWithNoCleanup, type IntervalWithNoCleanupIssue } from "./interval-with-no-cleanup";
export { listenerAddedByHand, type ListenerAddedByHandIssue } from "./listener-added-by-hand";
export { lateRequestRead, type LateRequestReadIssue } from "./late-request-read";
export { headTagsCollide, type HeadTagsCollideIssue } from "./head-tags-collide";
export { unguardedAsyncLifecycle, type UnguardedAsyncLifecycleIssue } from "./unguarded-async-lifecycle";
export { duplicateId, type DuplicateIdIssue } from "./duplicate-id";
export { headingSkipsALevel, type HeadingSkipsALevelIssue } from "./heading-skips-a-level";
export { clientOnlyRequestRead, type ClientOnlyRequestReadIssue } from "./client-only-request-read";
export { oneProviderPerComponent, type OneProviderPerComponentIssue } from "./one-provider-per-component";
export { unexposedEnvRead, type UnexposedEnvReadIssue } from "./unexposed-env-read";
export { computeTakesNoArguments, type ComputeTakesNoArgumentsIssue } from "./compute-takes-no-arguments";
export { rowReadsAPlainField, type RowReadsAPlainFieldIssue } from "./row-reads-a-plain-field";
export { serverEnvInSharedCode, type ServerEnvInSharedCodeIssue } from "./server-env-in-shared-code";
export { clientOnlyBecause, isServerOnly } from "./lifecycle-env";
export { contextHalfOf, type ContextHalf } from "./context-pair";
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
  propsWrittenByTheReceiver,
  computeTakesNoArguments,
  asyncRender,
  stateWrittenWhileRendering,
  stateMutatedInPlace,
  decoratorThatAddsNothing,
  unkeyableMemoizedArgument,
  clockReadWhileRendering,
  cachedReadOfAPlainField,
  arrowFields,
  browserUrl,
  domWrites,
  duplicateDecorators,
  unwatchedFields,
  watchOfAPropThatIsNotThere,
  persistOfALossyValue,
  unserializableState,
  intervalWithNoCleanup,
  listenerAddedByHand,
  lateRequestRead,
  headTagsCollide,
  unguardedAsyncLifecycle,
  contextConsumedAboveItsProvider,
  clientOnlyRequestRead,
  oneProviderPerComponent,
  serverEnvInSharedCode,
  freshObjectInHookProps,
  freshValueFromAWatchSelector,
] as const;

/** Every rule that reads a FILE. Same arrangement, different subject. */
export const MODULE_RULES = [
  unsplittableImport,
  unexposedEnvRead,
  rowReadsAPlainField,
  devGuardAsAnExpression,
] as const;

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
  parentWithAForeignChild,
  interactiveInsideInteractive,
  unnamedImage,
  unknownAriaAttribute,
  unknownRole,
  roleMissingRequiredAria,
  roleTakesNoName,
  regionWithNoName,
  falseOnABooleanAttribute,
  misspelledElementProperty,
  halfBuiltKeyboardPath,
  elementHtmlRemoved,
  optionThatCannotChoose,
  ariaValue,
  ariaWithNoSubject,
  emptyHeadingOrLink,
  unnamedFrame,
  positiveTabIndex,
  ariaHiddenOnFocusable,
  ariaHiddenAroundSomethingFocusable,
  presentationRoleOnFocusable,
  ariaStateWithNoRole,
  ariaStateTheRoleDoesNotHave,
  ariaThatContradictsTheTag,
  roleThatFightsTheTag,
  liveRegionThatContradictsItsRole,
  autocompleteThatFillsNothing,
  labelThatNamesNothing,
  tableWithNoHeaders,
  linkWithoutADestination,
  freshObjectInProps,
  functionBuiltInTheMarkup,
  objectAmongTheChildren,
  functionUsedAsATag,
  clickWithNoKeyboardPath,
  accessKey,
  attributeThatDoesNothing,
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
export const TREE_RULES = [duplicateId, headingSkipsALevel, moreThanOneMain, landmarksThatCannotBeToldApart] as const;

/** All four families, which is what the CLI prints from and what {@link Findings} is keyed by. */
/**
 * The rules whose subject is the WHOLE PROJECT — the fifth, and the only one needing two passes.
 *
 * Every other family reads its subject and answers in the same walk. These ask about ABSENCE, and
 * absence cannot be established from a file nobody has opened yet — so the run collects the id
 * table first and asks afterwards. See `ProjectRule`.
 */
export const PROJECT_RULES = [
  lazyImportsThatCollide,
  fragmentLinkToNowhere,
  referenceToAnIdThatIsNotThere,
  controlWithNoLabel,
  namedOnlyByAPlaceholder,
] as const;

export const RULES = [...CLASS_RULES, ...MODULE_RULES, ...ELEMENT_RULES, ...TREE_RULES, ...PROJECT_RULES] as const;

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
          : R extends ProjectRule<infer Issue>
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
  /** Every runtime code this rule answers, in the order the reference should list them. */
  alsoReportedAs?: readonly string[];
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
    // Normalised to a list here so every consumer has one shape to read. A rule may write a single
    // code, because most answer exactly one and a list of one reads as ceremony.
    ...("alsoReportedAs" in rule.report && rule.report.alsoReportedAs !== undefined
      ? {
          alsoReportedAs: (Array.isArray(rule.report.alsoReportedAs)
            ? rule.report.alsoReportedAs
            : [rule.report.alsoReportedAs]) as readonly string[],
        }
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
export function activate<R extends { id: string }>(
  all: readonly R[],
  imported: ReadonlySet<string>,
  rendersOnServer = true,
): R[] {
  // `"needs" in rule` rather than `rule.needs`: these are the rules' own inferred types, and a rule
  // that declares no `needs` has no such property to read. Narrowing asks the question the optional
  // field was meant to ask, without widening every rule to `Rule<unknown>` and losing its id.
  return all.filter((rule) => {
    if ("needs" in rule && rule.needs !== undefined && !imported.has(rule.needs as string)) return false;
    // The second gate, and the same shape as the first: a rule whose fault only exists when there
    // is a hydration blob to cross is not SKIPPED in a browser-only project, it is not asked.
    if ("needsServerRendering" in rule && rule.needsServerRendering === true && !rendersOnServer) return false;
    return true;
  });
}

/**
 * Pushes what a rule found into its own list.
 *
 * The one cast in the file. `findings[rule.id]` is a union of every rule's array type, because
 * `rule` is a union of every rule — so nothing can be pushed into it without saying, once, that the
 * pair came from the same rule. It did: both sides are read from the same object.
 */
/**
 * Where every finding from every family lands — and so the one place the annotation is applied.
 *
 * `silenced` is required rather than defaulted: a guard a caller can forget looks exactly like a
 * clean codebase, and this one decides whether a reader has any way out of a wrong report at all.
 */
function collect(findings: Findings, rule: AnyRule, issues: readonly unknown[], silenced: Silencer): void {
  for (const issue of issues) {
    const at = issue as { file: string; line: number; column: number };
    if (silenced(rule.id, at)) continue;
    (findings[rule.id] as unknown[]).push(issue);
  }
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
  silenced: Silencer,
): void {
  for (const rule of active) {
    // Same narrowing as `activate` uses for `needs`, and for the same reason.
    const exempt = "exempt" in rule ? (rule.exempt as string) : undefined;
    if (exempt !== undefined && context.self.id.startsWith(exempt)) continue;
    collect(findings, rule, rule.read(cls, context), silenced);
  }
}

/**
 * Every active per-file rule over one source file.
 *
 * The context used to be built PER RULE, because each of them carried an `unlessAnnotated` and the
 * reason it found had to be recorded against a rule name. Nothing varies per rule any more: the
 * annotation is read from the FINDING, in `collect`, which is where every family's findings already
 * meet — so a class rule cannot be the one that forgot to ask.
 */
/**
 * Every active element rule over one JSX element.
 *
 * **A spreading element is handed to almost nobody.** `<img {...rest} />` may carry the very
 * attribute a rule is about, and nothing static can say whether it does — so the silence contract
 * applies to the whole family at once, here, rather than being remembered by each of forty rules.
 * It is the same argument as `needs` and `exempt`: a guard every rule needs is a guard a rule can
 * forget.
 *
 * The exception is a rule declaring `evenWhenSpreading`, which is for a question a spread cannot
 * answer either way: a spread may supply an attribute that is MISSING, but it cannot un-build an
 * object literal written beside it. Such a rule takes on the guard itself.
 *
 * The context is built ONCE and shared. Forty rules asking "is there an `alt`" would otherwise walk
 * the same attribute list forty times.
 */
export function applyElement(
  active: readonly (typeof ELEMENT_RULES)[number][],
  element: JsxElementLike,
  findings: Findings,
  resolve: ElementContext["resolve"],
  silenced: Silencer,
): void {
  const context = contextFor(element, resolve);
  const asked = context.spreads ? active.filter((rule) => "evenWhenSpreading" in rule) : active;
  for (const rule of asked) collect(findings, rule, rule.read(element, context), silenced);
}

/**
 * Every active project rule, over the table built from the whole source set.
 *
 * Called ONCE per run rather than once per file, which is what having the project as a subject
 * means — and is why this is the only `apply*` that takes no node.
 */
export function applyProject(
  active: readonly (typeof PROJECT_RULES)[number][],
  project: ProjectContext,
  findings: Findings,
  silenced: Silencer,
): void {
  for (const rule of active) collect(findings, rule, rule.read(project), silenced);
}

export function applyModule(
  active: readonly (typeof MODULE_RULES)[number][],
  file: ts.SourceFile,
  context: ModuleContext,
  findings: Findings,
  silenced: Silencer,
): void {
  for (const rule of active) collect(findings, rule, rule.read(file, context), silenced);
}

/**
 * Every active tree rule over one render.
 *
 * The context is built ONCE and shared, as it is for elements — and it costs more to build here,
 * because it walks the whole tree and decides for every element whether it is really on the page.
 * A rule doing that itself would be doing it again for every other rule in the family.
 */
export function applyTree(
  active: readonly (typeof TREE_RULES)[number][],
  root: ts.Node,
  findings: Findings,
  resolve: ElementContext["resolve"],
  silenced: Silencer,
): void {
  if (active.length === 0) return;
  const tree = treeFor(root, resolve);
  for (const rule of active) collect(findings, rule, rule.read(tree), silenced);
}
