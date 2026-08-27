import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { compute, state } from "../base/decorators";
import { Component } from "../base/Component";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * The reactivity contract a `@compute` makes, asserted rather than assumed.
 *
 * Written during the review of this package because nothing stated these five properties in one
 * place, and the hardest of them is the one nobody writes a test for: **a dependency set that
 * SHRINKS**. A compute that reads `a` only on one branch must stop depending on `a` when the branch
 * stops being taken — and start again when it is. Hand-rolled reactivity gets that wrong constantly,
 * and the symptom is a value that is either stale or recomputed forever, both of them quiet.
 *
 * All five held the day this was written. It is here so that stays true.
 */
let records: RamondaDiagnostic[] = [];

beforeEach(() => {
  records = [];
  resetDiagnostics();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
});

afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
  vi.restoreAllMocks();
});

describe("what a @compute promises", () => {
  test("it caches, invalidates on what it read, and lets go of what it stopped reading", async () => {
    let runs = 0;

    class C extends Component {
      @state a = 1;
      @state b = 100;
      @state which = true;

      @compute get value(): number {
        runs++;
        // Reads `a` only while `which` is true, so the dependency set has to move with it.
        return this.which ? this.a : 0;
      }

      render() {
        return (
          <div>
            <span>
              {this.value}:{this.value}
            </span>
          </div>
        );
      }
    }

    const dom = await getDOM<C>(<C />);
    await dom.settle();

    // Read twice in one render, computed once.
    expect(runs).toBe(1);

    // A write to something it never read must not invalidate it.
    runs = 0;
    dom.instance.b = 999;
    await dom.settle();
    expect(runs).toBe(0);

    // A write to what it did read must.
    runs = 0;
    dom.instance.a = 2;
    await dom.settle();
    expect(runs).toBe(1);
    expect(dom.instance.value).toBe(2);

    // The set SHRINKS: with the branch closed, `a` is no longer a dependency.
    dom.instance.which = false;
    await dom.settle();
    runs = 0;
    dom.instance.a = 3;
    await dom.settle();
    expect(runs).toBe(0);
    expect(dom.instance.value).toBe(0);

    // And grows back when the branch opens again.
    dom.instance.which = true;
    await dom.settle();
    runs = 0;
    dom.instance.a = 4;
    await dom.settle();
    expect(runs).toBeGreaterThan(0);
    expect(dom.instance.value).toBe(4);

    // None of it is a fault: no churn or purity diagnostic fired along the way.
    expect(records.map((record) => record.code)).toEqual([]);
    dom.unmount();
  });
});
