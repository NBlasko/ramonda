import { afterEach, describe, expect, test } from "vitest";
import { Component, createRef } from "../../index";
import { bootstrap, unmount } from "../../index";
import { renderPhase } from "../../debug/renderPhase";
import { flushSync } from "../../testing";

/**
 * `createRef` in a production build, which nothing had ever called.
 *
 * The union of both coverage runs said so exactly: `base/Ref.ts`'s only branch outside `setCurrent`
 * is `if (__DEV__) reportRefBuiltInAPurePhase()` at line 44 — 61 calls in the development run and
 * **zero** in the production one. Development reports `RMD061` when a ref is built in a pure phase,
 * because a ref built in a render is a new identity every time and costs the child a render it did
 * not need; a shipped build must build the ref and say nothing, since taking a page down over
 * something that still renders correctly is the worse outcome.
 *
 * ## The guard at line 44 cannot be falsified from outside, and this file says so rather than
 * pretending otherwise
 *
 * Measured, by planting: removing `if (__DEV__)` from `createRef` fails **nothing** here. The
 * reporter asks `purePhase()` first and returns when it answers `undefined` — and it answers
 * `undefined` in a shipped build, because `renderPhase.component = component` is itself inside
 * `if (__DEV__)` in `helpers/generateRenderOutput.ts`. Two layers, and the outer one is
 * belt-and-braces.
 *
 * So the promise is asserted where it can actually fail. "the render phase is not marked at all" is
 * the mechanism that enforces silence, and planting the assignment outside its guard fails that test
 * — and a second one with it. That second failure is worth knowing about: the `finally` that clears
 * the mark lives inside the same `if (__DEV__)`, so an assignment outside it would leave a
 * production build marked as rendering forever, and the ref callback is one of the things that stops
 * behaving. The `RMD061` assertions stay because they are the promise a reader cares about — they are
 * simply not the thing holding it up.
 *
 * Run it the way `test:prod` does — `NODE_ENV=production` is what makes `__DEV__` false. Without it
 * every assertion here measures the development build while reading as production; the first test
 * exists to catch exactly that, and caught it once while this file was being written.
 */
const records: RamondaDiagnostic[] = [];
let seen: string[] = [];
let phaseDuringRender: string[] = [];

function collect(): void {
  records.length = 0;
  seen = [];
  phaseDuringRender = [];
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
}

afterEach(() => {
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
});

/** A ref built in the render itself — the shape the development build reports. */
class BuildsInRender extends Component {
  render() {
    phaseDuringRender.push(renderPhase.component === undefined ? "unmarked" : "marked");
    const ref = createRef<HTMLElement>((el) => seen.push(el === null ? "cleared" : `set:${el.id}`));
    return (
      <div>
        <p id="in-render" ref={ref}>
          text
        </p>
      </div>
    );
  }
}

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  bootstrap(<BuildsInRender />, container);
  flushSync();
  return container;
}

describe("createRef in a production build", () => {
  // Without this the whole file would be asserting the development path under another name.
  test("__DEV__ is false in this run", () => {
    expect(__DEV__).toBe(false);
  });

  test("the render phase is not marked at all, which is what keeps the guard quiet", () => {
    collect();
    const container = mount();

    expect(phaseDuringRender).toEqual(["unmarked"]);

    unmount(container);
    container.remove();
  });

  test("a ref built in a render is not reported, and it still receives the element", () => {
    collect();
    const container = mount();

    expect(records.map((record) => record.code)).toEqual([]);
    expect(seen).toEqual(["set:in-render"]);
    expect(container.querySelector("#in-render")).not.toBeNull();

    unmount(container);
    container.remove();
  });

  test("the ref is cleared on unmount, which is the half a report would have hidden", () => {
    collect();
    const container = mount();
    seen = [];

    unmount(container);
    flushSync();

    expect(seen).toEqual(["cleared"]);
    expect(records.map((record) => record.code)).toEqual([]);
    container.remove();
  });

  test("a ref built outside a render behaves the same, so the guard is the only difference", () => {
    collect();
    const ref = createRef<HTMLElement>();

    expect(ref.current).toBeNull();
    ref.setCurrent(null);
    expect(records.map((record) => record.code)).toEqual([]);
  });
});
