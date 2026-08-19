import { describe, expect, test } from "vitest";
import * as api from "../index";
import { RULES } from "../rules";

/**
 * What this package publishes, asserted as a list.
 *
 * The tripwire the other packages have, and this one is very late — which is what it is for. While
 * it did not exist, the package went from five rules to twenty-seven, every one of them adding a
 * published issue type, and **three of them were never exported at all**: `AriaValueIssue`,
 * `RoleMissingRequiredAriaIssue` and `RoleTakesNoNameIssue` were reachable through `findings` and
 * unnameable in an annotation. Nothing noticed, because nothing was looking.
 *
 * The docs' `check-api-coverage.mjs` reads these lists too, so a new export has to be acknowledged
 * twice: once as API here, once as a row on /reference/api.
 */
const EXPECTED = ["analyzeProject", "diffGraphs", "filesOf", "refuseToDiff", "ruleCatalogue", "splitOf"];

/**
 * The TYPES, which `Object.keys` cannot see because types are erased.
 *
 * Most of them are one rule's issue shape. They are API because the reference tells people to write
 * scripts against `analyzeProject`, and a script that reads `findings["arrow-fields"]` has to be
 * able to name what it is holding.
 */
const EXPECTED_TYPES = [
  "AccessKeyIssue",
  "AnalyzeResult",
  "AriaHiddenOnFocusableIssue",
  "AriaValueIssue",
  "AriaWithNoSubjectIssue",
  "ArrowFieldIssue",
  "AsyncRenderIssue",
  "BrowserUrlIssue",
  "ClassInsteadOfClassNameIssue",
  "ClickWithNoKeyboardPathIssue",
  "ClientOnlyRequestReadIssue",
  "ClockReadWhileRenderingIssue",
  "ComponentGraph",
  "ComputeReadsAPlainFieldIssue",
  "ContextConsumedAboveItsProviderIssue",
  "ControlWithNoLabelIssue",
  "ContextIssue",
  "DomWriteIssue",
  "DuplicateDecoratorIssue",
  "DuplicateIdIssue",
  "DuplicateKeyAmongSiblingsIssue",
  "EmptyHeadingOrLinkIssue",
  "Findings",
  "GraphDiff",
  "GraphEdge",
  "GraphNode",
  "FragmentLinkToNowhereIssue",
  "FreshObjectInPropsIssue",
  "HeadTagsCollideIssue",
  "HeadingSkipsALevelIssue",
  "IndexAsKeyIssue",
  "InteractiveInsideInteractiveIssue",
  "LateRequestReadIssue",
  "LinkWithoutADestinationIssue",
  "MediaWithNoCaptionsIssue",
  "NamedOnlyByAPlaceholderIssue",
  "PersistOfALossyValueIssue",
  "PositiveTabIndexIssue",
  "ReferenceToAnIdThatIsNotThereIssue",
  "RoleMissingRequiredAriaIssue",
  "RoleTakesNoNameIssue",
  "RowWithoutAKeyIssue",
  "RuleSummary",
  "Split",
  "SplitPoint",
  "StateWrittenWhileRenderingIssue",
  "TagNeedsItsParentIssue",
  "UnguardedAsyncLifecycleIssue",
  "UnknownAriaAttributeIssue",
  "UnknownRoleIssue",
  "UnnamedFrameIssue",
  "UnnamedImageIssue",
  "UnsplittableImportIssue",
  "UnwatchedFieldIssue",
  "WatchOfAPropThatIsNotThereIssue",
  "Where",
];

describe("public API surface", () => {
  test("the entry exports exactly what it means to", () => {
    const actual = Object.keys(api).sort();
    const expected = [...EXPECTED].sort();

    const added = actual.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !actual.includes(name));

    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  /**
   * The rule registry is NOT reachable, and that is a decision rather than an oversight.
   *
   * A rule carries functions over its own issue type and a `read` that takes a compiler node —
   * publishing it would make this package's internals somebody's dependency, and would make every
   * change to a rule's shape a breaking change. `ruleCatalogue()` is the answer to what a caller
   * actually wants: four strings per rule, which is what a table or a report needs.
   */
  test("the rules themselves are not published", () => {
    for (const name of ["RULES", "CLASS_RULES", "ELEMENT_RULES", "MODULE_RULES", "TREE_RULES", "applyClass"]) {
      expect(api).not.toHaveProperty(name);
    }
  });

  /**
   * Every rule's issue type has to be nameable.
   *
   * This is the check that would have caught the three that were missing, and it is written against
   * the REGISTRY rather than a second list: a rule added tomorrow brings its issue type with it, and
   * the id is the only thing tying the two together that cannot drift.
   *
   * The naming convention is what makes it mechanical — `arrow-fields` produces `ArrowFieldIssue`
   * — so where a rule's type is not the id in PascalCase, it is listed here beside the reason.
   */
  test("every rule's issue type is exported", () => {
    const exceptions: Record<string, string> = {
      // Plural id, singular type: one report is one field.
      "arrow-fields": "ArrowFieldIssue",
      "dom-writes": "DomWriteIssue",
      "duplicate-decorators": "DuplicateDecoratorIssue",
      "unwatched-fields": "UnwatchedFieldIssue",
      // The rule is named for the value it reads; the type is named for the attribute.
      "aria-value": "AriaValueIssue",
      // Two words the id spells as one, because an attribute is one word in the markup.
      "class-instead-of-classname": "ClassInsteadOfClassNameIssue",
      "positive-tabindex": "PositiveTabIndexIssue",
    };

    const missing = RULES.map((rule) => {
      const expected =
        exceptions[rule.id] ??
        `${rule.id
          .split("-")
          .map((word) => word[0].toUpperCase() + word.slice(1))
          .join("")}Issue`;
      return EXPECTED_TYPES.includes(expected) ? undefined : `${rule.id} → ${expected}`;
    }).filter((name) => name !== undefined);

    expect(missing).toEqual([]);
  });
});
