export { analyzeProject } from "./analyze";
// Every rule this package runs, as four strings each — what a generator needs to describe them.
// The documentation site's rule tables are built from this, so they cannot drift from the rules.
export { ruleCatalogue } from "./rules";
export type { RuleSummary } from "./rules";
// Every issue `AnalyzeResult` carries, nameable. Two were once missing, so a script written
// against `analyzeProject` — which the reference tells people to write — could type a variable holding a
// context issue but not one holding a duplicate decorator.
export type {
  AnalyzeResult,
  AriaValueIssue,
  AriaWithNoSubjectIssue,
  ArrowFieldIssue,
  AsyncRenderIssue,
  BrowserUrlIssue,
  ClassInsteadOfClassNameIssue,
  ClickWithNoKeyboardPathIssue,
  ClientOnlyRequestReadIssue,
  ClockReadWhileRenderingIssue,
  ComputeReadsAPlainFieldIssue,
  ContextConsumedAboveItsProviderIssue,
  ContextIssue,
  DomWriteIssue,
  DuplicateDecoratorIssue,
  DuplicateIdIssue,
  DuplicateKeyAmongSiblingsIssue,
  EmptyHeadingOrLinkIssue,
  Findings,
  HeadingSkipsALevelIssue,
  FragmentLinkToNowhereIssue,
  FreshObjectInPropsIssue,
  HeadTagsCollideIssue,
  InteractiveInsideInteractiveIssue,
  LateRequestReadIssue,
  IndexAsKeyIssue,
  LinkWithoutADestinationIssue,
  MediaWithNoCaptionsIssue,
  PersistOfALossyValueIssue,
  PositiveTabIndexIssue,
  AccessKeyIssue,
  AriaHiddenOnFocusableIssue,
  ReferenceToAnIdThatIsNotThereIssue,
  RoleMissingRequiredAriaIssue,
  RoleTakesNoNameIssue,
  RowWithoutAKeyIssue,
  StateWrittenWhileRenderingIssue,
  TagNeedsItsParentIssue,
  UnguardedAsyncLifecycleIssue,
  UnknownAriaAttributeIssue,
  UnknownRoleIssue,
  UnnamedFrameIssue,
  UnnamedImageIssue,
  UnsplittableImportIssue,
  UnwatchedFieldIssue,
  WatchOfAPropThatIsNotThereIssue,
} from "./analyze";
// The composition graph the issues are computed from. A FORMAT rather than an API: it is versioned
// by `schema` and there is no second consumer yet, so nothing here is documented for one.
export type { ComponentGraph, GraphEdge, GraphNode, Where } from "./graph";
// Two readings of that graph, both computed from it alone with no second walk over the source:
// where the app splits and what each piece carries, and what changed between two graphs.
export { filesOf, splitOf } from "./split";
export type { Split, SplitPoint } from "./split";
export { diffGraphs, refuseToDiff } from "./diff";
export type { GraphDiff } from "./diff";
