import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { BaseComponent } from "../types/vdom";
import { resetDiagnostics } from "../debug/diagnostics";
import { labelState, stateLabel, stateProperty } from "../debug/stateLabels";
import {
  computePhase,
  inspectPhase,
  renderPhase,
  reportWriteDuringCompute,
  reportWriteDuringInspect,
  reportWriteDuringRender,
} from "../debug/renderPhase";

/**
 * What the debug labels say when there is nothing to say.
 *
 * Four branches, one subject, and the coverage union named all four: the else arm of
 * `stateLabels.ts`'s `label.owner ? … : label.property`, and the `?? "a signal"` in each of
 * `renderPhase.ts`'s three reporters. Neither run had ever taken any of them.
 *
 * ## Why no ordinary use reaches them, which is the reason they were unhit
 *
 * A signal is labelled only when it is built with `metaData`, and the framework builds exactly three
 * kinds. `@state` (`base/decorators.ts:267`) passes `metaData` AND `owner` — and its owner is
 * `displayName(this)`, which answers `"Unknown"` rather than `undefined` for a nameless class, so it
 * is never falsy. The other two are PROPS signals (`base/Component.ts:49`, `base/Hook.ts:26`), built
 * with no `metaData` at all: those are the unlabelled ones. And a write to props never reaches
 * `State.set` — the proxy's `set` trap throws `[RMD004]` in every build, outside `if (__DEV__)`, so
 * the report these fallbacks belong to cannot be raised about a props signal.
 *
 * So both are there because the options are OPTIONAL — `metaData?: string`, `owner?: string` — and no
 * call site exercises the absence yet. What they promise is a graceful DEGRADATION, and that is worth
 * pinning: the day a call site omits one, a reader must get `items` rather than `undefined.items`,
 * and `a signal` rather than a message with a hole in it.
 *
 * Called directly for that reason. There is no arrangement of components that produces an unlabelled
 * signal inside a marked phase, and inventing one would be testing the invention.
 */
class Panel {}

const component = () => new Panel() as unknown as BaseComponent;
const records: RamondaDiagnostic[] = [];

beforeEach(() => {
  records.length = 0;
  resetDiagnostics();
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
});

afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
  renderPhase.component = undefined;
  inspectPhase.instance = undefined;
  computePhase.label = undefined;
  resetDiagnostics();
});

describe("a signal with no label, and a label with no owner", () => {
  test("a label is qualified by its owner when it has one", () => {
    const signal = {};
    labelState(signal, "items", "TodoList");

    expect(stateLabel(signal)).toBe("TodoList.items");
    expect(stateProperty(signal)).toBe("items");
  });

  test("and degrades to the bare property when it does not", () => {
    const signal = {};
    labelState(signal, "items", undefined);

    expect(stateLabel(signal)).toBe("items");
  });

  test("a signal nothing labelled has no label at all, which is the other half", () => {
    expect(stateLabel({})).toBeUndefined();
    expect(stateProperty({})).toBeUndefined();
  });

  test("a write during render names the property, or says `a signal` when there is none", () => {
    renderPhase.component = component();

    const labelled = {};
    labelState(labelled, "items", "Panel");
    reportWriteDuringRender(labelled);
    expect(records.at(-1)?.message).toContain("`items`");

    reportWriteDuringRender({});
    expect(records.at(-1)?.code).toBe("RMD001");
    expect(records.at(-1)?.message).toContain("`a signal`");
  });

  test("a write from [INSPECT]() does the same", () => {
    inspectPhase.instance = component();

    reportWriteDuringInspect({});

    expect(records.at(-1)?.code).toBe("RMD030");
    expect(records.at(-1)?.message).toContain("`a signal`");
  });

  test("and a write from a @compute does too", () => {
    computePhase.label = "total";

    reportWriteDuringCompute({});

    expect(records.at(-1)?.code).toBe("RMD018");
    expect(records.at(-1)?.message).toContain("`a signal`");
  });

  test("each reporter is silent when its phase is not marked, which is what keeps them cheap", () => {
    // The early return above each fallback: no phase, no report. Asserted here because the tests
    // above set a phase by hand, and a reporter that fired regardless would pass all of them.
    reportWriteDuringRender({});
    reportWriteDuringInspect({});
    reportWriteDuringCompute({});

    expect(records).toEqual([]);
  });
});
