import { describe, test, expect } from "vitest";
import { Component } from "../../base/Component";
import { Host, state } from "../../base/decorators";
import { list } from "../../base/list";
import { renderPage } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";
import { getDOM } from "../../test/setup";

/**
 * A list keeps its per-item identity across a reorder on a HYDRATED page.
 *
 * The bug this locks was found with the `For` hook, and the cause was not in the
 * list code at all: `useCommon` calls a hook's options callback immediately,
 * during construction — so a hook's options are captured from the component's
 * FIELD INITIALIZERS, before the state blob is restored over them. Nothing on
 * the hydration path refreshed them afterwards (the build path does it at the
 * top of `updateBuild`).
 *
 * A list is where that hurt most, because its identity is the ITEM — an object
 * reference — and a restored array is a JSON round trip, so those are new
 * objects. The hook was still holding the initializer's array, minted ids for
 * those, and adopted the server's DOM with them. The first reorder handed it the
 * restored objects, which it had never seen, so it minted fresh ids (`f2`/`f3`
 * against the nodes' `f0`/`f1`), every key missed, and the whole list was
 * rebuilt: state lost, @destroyed and @created run again.
 *
 * `list()` reads `each` during the diff rather than at construction, so it
 * cannot reach the DOM with stale items the way the hook could. The refresh in
 * `hydrate.ts` still matters for every OTHER hook, and this stays as the
 * end-to-end check that a hydrated list reorders instead of rebuilding.
 *
 * Measured before the fix — reversing a three-item list, tracking instance ids
 * and node reuse:
 *
 *   as / render + fresh build     ids [1,2] -> [2,1]   2/2 nodes reused
 *   as / render + HYDRATED        ids [3,4] -> [5,6]   0/2 nodes reused
 *   hydrated, SECOND reorder                           2/2 nodes reused
 *
 * The second reorder recovering is what pointed at a first-pass problem rather
 * than a diff problem.
 */

interface Task {
  title: string;
}

@Host("li")
class Row extends Component<{ item: Task }> {
  @state clicks = 0;
  render() {
    return (
      <span>
        {this.props.item.title}:{this.clicks}
      </span>
    );
  }
}

@Host("div")
class Board extends Component {
  @state tasks: Task[] = [{ title: "a" }, { title: "b" }, { title: "c" }];
  render() {
    return <ul>{list({ each: this.tasks, as: Row })}</ul>;
  }
}

function texts(root: Element): string[] {
  return [...root.querySelectorAll("li")].map((li) => li.textContent ?? "");
}

async function hydrated() {
  const page = await renderPage(<Board />);
  const element = document.createElement("div");
  document.body.appendChild(element);
  element.innerHTML = page.body;
  hydrateRoot(<Board />, element);
  await Promise.resolve();
  const instance = (element.firstChild as unknown as { _componentInstance: Board })._componentInstance;
  return { element, instance, settle: () => Promise.resolve() };
}

describe("a list keeps per-item state across a reorder", () => {
  test("on a freshly built tree", async () => {
    const { container, instance, settle } = await getDOM<Board>(<Board />);

    const first = (
      container.querySelectorAll("li")[0] as unknown as {
        _componentInstance: Row;
      }
    )._componentInstance;
    first.clicks = 5;
    await settle();
    expect(texts(container)).toEqual(["a:5", "b:0", "c:0"]);

    instance.tasks = [...instance.tasks].reverse();
    await settle();

    // The row moved and took its state with it.
    expect(texts(container)).toEqual(["c:0", "b:0", "a:5"]);
  });

  test("on a hydrated tree", async () => {
    const { element, instance, settle } = await hydrated();

    const first = (
      element.querySelectorAll("li")[0] as unknown as {
        _componentInstance: Row;
      }
    )._componentInstance;
    first.clicks = 5;
    await settle();
    await settle();
    expect(texts(element)).toEqual(["a:5", "b:0", "c:0"]);

    instance.tasks = [...instance.tasks].reverse();
    await settle();
    await settle();

    // Before the fix this was ["c:0", "b:0", "a:0"] — the 5 lost, and every row
    // a NEW component instance.
    expect(texts(element)).toEqual(["c:0", "b:0", "a:5"]);
    element.remove();
  });

  test("and the second reorder too", async () => {
    const { element, instance, settle } = await hydrated();

    // This used to be the broken one; it is here to keep both passes covered.
    instance.tasks = [...instance.tasks].reverse();
    await settle();
    await settle();

    const before = [...element.querySelectorAll("li")];
    const bumped = (before[0] as unknown as { _componentInstance: Row })._componentInstance;
    bumped.clicks = 7;
    await settle();
    await settle();

    instance.tasks = [...instance.tasks].reverse();
    await settle();
    await settle();

    // Every node reused, state moved with it — which is what narrows the bug to
    // whatever hydration leaves in the child record for the first reconcile.
    const after = [...element.querySelectorAll("li")];
    expect(after.filter((node) => before.includes(node)).length).toBe(3);
    expect(texts(element).at(-1)).toContain(":7");
    element.remove();
  });
});
