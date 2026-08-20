import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { ShouldUpdateOnPropsChange, StableProps, state } from "../base/decorators";
import { configureDev } from "../config";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * `@StableProps` on a COMPONENT: the parent writes the literal, the child declares it a value.
 *
 * An object literal in JSX is a fresh reference on every render, so `<Panel filter={{ q }} />` hands
 * the child a changed prop every time and re-renders it forever. The other control a component has
 * is `@ShouldUpdateOnPropsChange`, and it takes a PREDICATE — a thing an app can get wrong in the
 * direction that matters, a component that stops rendering when it should. This takes NAMES: the
 * framework does the comparing, and the worst a mistake can do is fail to type-check.
 */
let childRenders = 0;

@StableProps("filter", "flags")
class Panel extends Component<{ filter: { q: string }; flags: string[]; label: string }> {
  render() {
    childRenders++;
    return (
      <li>
        {this.props.label} {this.props.filter.q} {this.props.flags.length}
      </li>
    );
  }
}

class Undeclared extends Component<{ filter: { q: string } }> {
  render() {
    childRenders++;
    return <li>{this.props.filter.q}</li>;
  }
}

class Parent extends Component {
  @state tick = 0;
  render() {
    return (
      <ul>
        <Panel filter={{ q: "open" }} flags={["a", "b"]} label="one" />
      </ul>
    );
  }
}

class ParentUndeclared extends Component {
  @state tick = 0;
  render() {
    return (
      <ul>
        <Undeclared filter={{ q: "open" }} />
      </ul>
    );
  }
}

class ChangingParent extends Component {
  @state tick = 0;
  render() {
    return (
      <ul>
        <Panel filter={{ q: `open-${this.tick}` }} flags={["a"]} label="one" />
      </ul>
    );
  }
}

describe("@StableProps on a component", () => {
  test("a declared prop written as a literal stops re-rendering the child", async () => {
    childRenders = 0;
    const dom = await getDOM<Parent>(<Parent />);
    await dom.settle();
    const afterMount = childRenders;

    for (let i = 1; i <= 5; i++) {
      dom.instance.tick = i;
      await dom.settle();
    }

    expect(afterMount).toBe(1);
    expect(childRenders - afterMount).toBe(0);
    dom.unmount();
  });

  /** The control. Without the declaration the same markup re-renders the child every time. */
  test("an undeclared prop still re-renders it, which is what the declaration is for", async () => {
    childRenders = 0;
    const dom = await getDOM<ParentUndeclared>(<ParentUndeclared />);
    await dom.settle();
    const afterMount = childRenders;

    for (let i = 1; i <= 5; i++) {
      dom.instance.tick = i;
      await dom.settle();
    }

    expect(childRenders - afterMount).toBe(5);
    dom.unmount();
  });

  /** A declaration is not a freeze: contents that really move still reach the child. */
  test("a declared prop whose contents change is handed over", async () => {
    childRenders = 0;
    const dom = await getDOM<ChangingParent>(<ChangingParent />);
    await dom.settle();
    const afterMount = childRenders;

    dom.instance.tick = 1;
    await dom.settle();

    expect(childRenders - afterMount).toBe(1);
    expect(dom.container.querySelector("li")?.textContent).toContain("open-1");
    dom.unmount();
  });
});

/**
 * The double render has to know about the declaration.
 *
 * RMD020 renders twice and reports a value the second render built afresh — which is exactly what an
 * object literal in JSX is. Reporting it on a prop the child has DECLARED would be reporting the fix.
 */
describe("RMD020 and a declared prop", () => {
  let records: RamondaDiagnostic[] = [];

  beforeEach(() => {
    configureDev({ strictRender: true });
    records = [];
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation(() => {});
    globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
  });

  afterEach(() => {
    configureDev({ strictRender: false });
    globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
    vi.restoreAllMocks();
  });

  test("a declared prop is not reported as rebuilt", async () => {
    const dom = await getDOM(<Parent />);
    await dom.settle();

    expect(records.filter((record) => record.code === "RMD020")).toEqual([]);
    dom.unmount();
  });

  test("an undeclared one still is, so the check has not been switched off", async () => {
    const dom = await getDOM(<ParentUndeclared />);
    await dom.settle();

    expect(records.some((record) => record.code === "RMD020")).toBe(true);
    dom.unmount();
  });
});

/**
 * Both decorators on one component, which is now a reachable combination.
 *
 * The ORDER is the whole of it: `resolveStable` runs first, so a hand-written gate is handed the
 * RESOLVED props — `previous.filter !== next.filter` sees "the same" when the contents match, which
 * is what the declaration promised. Resolving after the gate would mean a component taking props
 * identical to the ones it already had.
 */
describe("@StableProps beside @ShouldUpdateOnPropsChange", () => {
  test("the gate sees the settled reference, not the parent's fresh literal", async () => {
    const sawSameReference: boolean[] = [];

    @StableProps("filter")
    @ShouldUpdateOnPropsChange((_self, previous: { filter: unknown }, next: { filter: unknown }) => {
      sawSameReference.push(previous.filter === next.filter);
      return true;
    })
    class Gated extends Component<{ filter: { q: string } }> {
      render() {
        return <li>{this.props.filter.q}</li>;
      }
    }

    class Owner extends Component {
      @state tick = 0;
      render() {
        return (
          <ul>
            <Gated filter={{ q: "open" }} />
          </ul>
        );
      }
    }

    const dom = await getDOM<Owner>(<Owner />);
    await dom.settle();
    dom.instance.tick = 1;
    await dom.settle();

    expect(sawSameReference).toEqual([true]);
    dom.unmount();
  });
});
