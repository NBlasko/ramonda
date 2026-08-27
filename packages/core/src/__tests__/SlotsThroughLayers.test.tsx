import { describe, test, expect } from "vitest";
import { getDOM, findAll } from "../test/setup";
import { state, created, mounted, updated, destroyed } from "../base/decorators";
import { Component } from "../base/Component";
import type { RamondaNode } from "../types/vdom";

/**
 * Content handed DOWN through slots, and what happens to it on the way.
 *
 * A slot is a prop like any other — `children` by convention, or a name the component chose — and
 * what travels through it is a vnode built by whoever wrote the JSX. So a payload is written in one
 * component's render and PLACED in another's, several levels apart, and every question the diff
 * asks about a child has to survive that separation:
 *
 *   - is it built once, or once per level it passes through?
 *   - when the component it lands in re-renders, is it kept or rebuilt?
 *   - when siblings around it appear, disappear or reorder, does it keep its own node?
 *   - and whose child is it, for a lifecycle that runs parents and children in a fixed order?
 *
 * The last one has an answer worth stating outright, because it is a design decision and not an
 * accident: **a slot belongs where it LANDS, not where it was written.** Measured below.
 */

const log: string[] = [];
let serial = 0;

/** Announces every phase of its life, and carries a serial so a REBUILD is visible as a new number. */
class Leaf extends Component<{ tag: string; note?: string }> {
  readonly serial = ++serial;
  @created c() {
    log.push(`created:${this.props.tag}`);
  }
  @mounted m() {
    log.push(`mounted:${this.props.tag}`);
  }
  @updated u() {
    log.push(`updated:${this.props.tag}`);
  }
  @destroyed d() {
    log.push(`destroyed:${this.props.tag}`);
  }
  render() {
    return (
      <b id={this.props.tag} data-serial={String(this.serial)}>
        {this.props.tag}
        {this.props.note ?? ""}
      </b>
    );
  }
}

/**
 * A NOTE ON THE TYPE, because these two classes need a cast and a reader deserves the reason.
 *
 * `RamondaNode` is `RamondaAtom | RamondaAtom[]` — one level of array. `props.children` is itself an
 * array, so `[chrome, this.props.children]` is an array holding an array and TypeScript refuses it,
 * although the runtime handles it correctly (`generateRenderOutput` normalizes its output the way
 * every other children position is normalized).
 *
 * That gap is deliberate here rather than papered over: the tests below are about what the RUNTIME
 * does with a nested slot, and a typed app reaching this shape would first have to argue with the
 * compiler. Whether the type should widen to match is a separate decision.
 */
/**
 * Passes its children through with optional chrome, written the way that KEEPS the slot.
 *
 * `[cond ? <i/> : null, children]` and `cond ? [<i/>, children] : [children]` render the same two
 * shapes, and they are not the same thing to the diff: a slot is found again by its POSITION among
 * its siblings, so the second spelling moves the children from index 0 to index 1 and the region
 * that held them is not the one being asked for. `FrameBranching` below is that second spelling,
 * and the difference between them is measured in its own test.
 */
class Frame extends Component<{ chrome?: boolean; children?: RamondaNode }> {
  render(): RamondaNode {
    // An ARRAY holding a slot: the shape that has no wrapper element to hide behind.
    return [this.props.chrome ? <i id="chrome">chrome</i> : null, this.props.children] as RamondaNode;
  }
}

/** The same two shapes, written as two different pieces of JSX. See the test that measures it. */
class FrameBranching extends Component<{ chrome?: boolean; children?: RamondaNode }> {
  render(): RamondaNode {
    return (
      this.props.chrome ? [<i id="chrome">chrome</i>, this.props.children] : [this.props.children]
    ) as RamondaNode;
  }
}

const serialsOf = (root: Element) =>
  Object.fromEntries(findAll<Leaf>(root, "Leaf").map((leaf) => [leaf.props.tag, leaf.serial]));

describe("a slot handed down through several components", () => {
  test("is built once, however many levels it passes through", async () => {
    class Deep extends Component<{ children?: RamondaNode }> {
      render() {
        return <div id="deep">{this.props.children}</div>;
      }
    }
    class Mid extends Component<{ children?: RamondaNode }> {
      render() {
        return (
          <div id="mid">
            <Deep>{this.props.children}</Deep>
          </div>
        );
      }
    }
    class App extends Component {
      render() {
        return (
          <div id="app">
            <Mid>
              <Leaf tag="payload" />
            </Mid>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    // One instance, at the bottom, and nothing of it left at the levels it passed through.
    expect(findAll<Leaf>(app.container, "Leaf")).toHaveLength(1);
    expect(app.container.querySelector("#app")!.innerHTML).toBe(
      '<div id="mid"><div id="deep"><b id="payload" data-serial="' +
        findAll<Leaf>(app.container, "Leaf")[0]!.serial +
        '">payload</b></div></div>',
    );
  });

  test("belongs to where it LANDS, not to where it was written", async () => {
    /**
     * The payload is a piece of `App`'s JSX, but it is placed by `Deep`. Its lifecycle parent is
     * `Deep` and its depth is `Deep`'s plus one — which is why it runs with the bottom of the tree
     * and not with the top. The same rule a context lookup follows.
     */
    class Deep extends Component<{ children?: RamondaNode }> {
      render() {
        return <div id="deep">{this.props.children}</div>;
      }
    }
    class Mid extends Component<{ children?: RamondaNode }> {
      render() {
        return <Deep>{this.props.children}</Deep>;
      }
    }
    class App extends Component {
      render() {
        return (
          <Mid>
            <Leaf tag="payload" />
          </Mid>
        );
      }
    }

    log.length = 0;
    const app = await getDOM<App>(<App />);
    await app.settle();

    // Created on the way DOWN, mounted on the way back UP — and the payload is at the bottom of
    // both, although `App` is what wrote it.
    expect(log).toEqual(["created:payload", "mounted:payload"]);

    log.length = 0;
    app.unmount();
    expect(log).toEqual(["destroyed:payload"]);
  });

  test("survives chrome appearing beside it, without being rebuilt", async () => {
    class App extends Component {
      @state chrome = false;
      render() {
        return (
          <div id="app">
            <Frame chrome={this.chrome}>
              <Leaf tag="payload" />
            </Frame>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    const before = serialsOf(app.container);
    const node = app.container.querySelector("#payload")!;

    log.length = 0;
    app.instance.chrome = true;
    await app.settle();

    // The chrome is in front of it, in the right order …
    expect(app.container.querySelector("#app")!.innerHTML).toContain('<i id="chrome">chrome</i><b id="payload"');
    // … and the payload is the very same node and the very same instance.
    expect(app.container.querySelector("#payload")).toBe(node);
    expect(serialsOf(app.container)).toEqual(before);
    expect(log).toEqual([]);

    app.instance.chrome = false;
    await app.settle();
    expect(app.container.querySelector("#payload")).toBe(node);
    expect(serialsOf(app.container)).toEqual(before);
  });
});

describe("the shape of the JSX around a slot decides whether it survives", () => {
  /**
   * Two spellings of the same two shapes, and they are not the same thing to the diff.
   *
   * A slot is found again by its POSITION among its siblings — that is what `SLOT_SYM` is, and what
   * lets a conditional sibling appear without every child after it losing its node. Writing the
   * condition as two DIFFERENT arrays moves the slot from index 0 to index 1, so the region being
   * asked for is not the one that is there, and the payload is rebuilt: torn down, and a new
   * instance in its place with none of its state.
   *
   * Neither spelling is wrong — this is what the rule costs, and it is worth a reader's five
   * seconds. Both halves are measured here so that a change to either one is visible.
   */
  class Branching extends Component {
    @state chrome = false;
    render() {
      return (
        <div id="app">
          <FrameBranching chrome={this.chrome}>
            <Leaf tag="payload" />
          </FrameBranching>
        </div>
      );
    }
  }

  class Steady extends Component {
    @state chrome = false;
    render() {
      return (
        <div id="app">
          <Frame chrome={this.chrome}>
            <Leaf tag="payload" />
          </Frame>
        </div>
      );
    }
  }

  test("a hole holds the place, so the payload lives", async () => {
    const app = await getDOM<Steady>(<Steady />);
    await app.settle();
    const before = serialsOf(app.container);

    log.length = 0;
    app.instance.chrome = true;
    await app.settle();

    expect(app.container.querySelector("#app")!.innerHTML).toContain('<i id="chrome">chrome</i><b id="payload"');
    expect(serialsOf(app.container)).toEqual(before);
    expect(log).toEqual([]);
  });

  test("two different arrays renumber it, so the payload is rebuilt", async () => {
    const app = await getDOM<Branching>(<Branching />);
    await app.settle();
    const before = serialsOf(app.container);

    log.length = 0;
    app.instance.chrome = true;
    await app.settle();

    // The markup is right either way — that is what makes this easy to miss.
    expect(app.container.querySelector("#app")!.innerHTML).toContain('<i id="chrome">chrome</i><b id="payload"');
    // But the payload is a different instance, and it was told so.
    expect(serialsOf(app.container).payload).not.toBe(before.payload);
    /**
     * `created` BEFORE `destroyed`, which is the build order and not an oversight: a replacement is
     * built detached, then the node it replaces is unmounted, then the new one is placed and
     * mounted. That is what lets `@destroyed` see a document holding only itself — the alternative,
     * inserting first, showed a departing component both copies.
     */
    expect(log).toEqual(["created:payload", "destroyed:payload", "mounted:payload"]);
  });
});

describe("two components each passing a slot of their own", () => {
  class App extends Component {
    @state showFirst = true;
    @state chrome = false;
    render() {
      return (
        <div id="app">
          {this.showFirst ? (
            <Frame chrome={this.chrome}>
              <Leaf tag="one" />
            </Frame>
          ) : null}
          <Frame chrome={this.chrome}>
            <Leaf tag="two" />
          </Frame>
        </div>
      );
    }
  }

  test("their payloads never swap, through a hide and a show", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();

    const before = serialsOf(app.container);
    expect(Object.keys(before).sort()).toEqual(["one", "two"]);
    const twoNode = app.container.querySelector("#two")!;

    // The FIRST one goes: the second must keep its own node and its own instance rather than
    // sliding up into the gap.
    log.length = 0;
    app.instance.showFirst = false;
    await app.settle();

    expect(log).toEqual(["destroyed:one"]);
    expect(app.container.querySelector("#one")).toBeNull();
    expect(app.container.querySelector("#two")).toBe(twoNode);
    expect(serialsOf(app.container).two).toBe(before.two);

    // And back: a NEW `one` — it was destroyed, so this is honestly a rebuild — while `two` is
    // still untouched.
    log.length = 0;
    app.instance.showFirst = true;
    await app.settle();

    expect(log).toEqual(["created:one", "mounted:one"]);
    expect(app.container.querySelector("#two")).toBe(twoNode);
    expect(serialsOf(app.container).two).toBe(before.two);
    expect(serialsOf(app.container).one).not.toBe(before.one);
  });

  test("chrome appearing in BOTH at once leaves each payload with its own", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();

    const before = serialsOf(app.container);
    app.instance.chrome = true;
    await app.settle();

    const chromes = [...app.container.querySelectorAll("#chrome")];
    expect(chromes).toHaveLength(2);
    // Each chrome sits directly in front of its own payload.
    expect(chromes[0]!.nextElementSibling!.id).toBe("one");
    expect(chromes[1]!.nextElementSibling!.id).toBe("two");
    expect(serialsOf(app.container)).toEqual(before);
  });
});

describe("several named slots into one component", () => {
  class Panel extends Component<{ head?: RamondaNode; body?: RamondaNode; foot?: RamondaNode }> {
    render() {
      return (
        <section id="panel">
          <header id="head">{this.props.head}</header>
          <main id="middle">{this.props.body}</main>
          <footer id="foot">{this.props.foot}</footer>
        </section>
      );
    }
  }

  class App extends Component {
    @state swapped = false;
    @state withBody = true;
    render() {
      return (
        <Panel
          head={this.swapped ? <Leaf tag="beta" /> : <Leaf tag="alpha" />}
          body={this.withBody ? <Leaf tag="body" /> : null}
          foot={this.swapped ? <Leaf tag="alpha" /> : <Leaf tag="beta" />}
        />
      );
    }
  }

  test("each lands in its own place, and a middle one may be empty", async () => {
    const app = await getDOM<App>(<App />);
    await app.settle();

    const where = (tag: string) => app.container.querySelector(`#${tag}`)!.parentElement!.id;
    expect(where("alpha")).toBe("head");
    expect(where("body")).toBe("middle");
    expect(where("beta")).toBe("foot");

    log.length = 0;
    app.instance.withBody = false;
    await app.settle();

    // Only the middle one goes; the two around it are untouched.
    expect(log).toEqual(["destroyed:body"]);
    expect(app.container.querySelector("#middle")!.innerHTML).toBe("");
    expect(where("alpha")).toBe("head");
    expect(where("beta")).toBe("foot");
  });

  test("swapping two slots moves the PROPS, not the instances — and state stays behind", async () => {
    /**
     * The comfortable reading is "the content moved from the header to the footer". It did not.
     *
     * `head` and `foot` are two props landing in two places, and each place already holds a `Leaf`
     * region. A component of the same class in the same slot is ADOPTED and handed the new props —
     * the same rule that keeps a counter alive while its label changes. So nothing is created and
     * nothing is destroyed: the two instances stay exactly where they are and trade what they
     * display.
     *
     * Measured: the instance in the header keeps its serial across the swap and its `tag` goes from
     * `alpha` to `beta`, and only `@updated` fires. **Internal state therefore stays with the
     * POSITION, not with the content** — which is the half a reader has to know before putting
     * state in a component they intend to move between slots. A `key` is what says otherwise.
     */
    const app = await getDOM<App>(<App />);
    await app.settle();

    const headBefore = app.container.querySelector("#head")!.firstElementChild!.getAttribute("data-serial");
    const footBefore = app.container.querySelector("#foot")!.firstElementChild!.getAttribute("data-serial");
    expect(app.container.querySelector("#head")!.firstElementChild!.id).toBe("alpha");

    log.length = 0;
    app.instance.swapped = true;
    await app.settle();

    // What is DISPLAYED swapped …
    expect(app.container.querySelector("#head")!.firstElementChild!.id).toBe("beta");
    expect(app.container.querySelector("#foot")!.firstElementChild!.id).toBe("alpha");

    // … while the instances did not move: same serial in the same place, with new props.
    expect(app.container.querySelector("#head")!.firstElementChild!.getAttribute("data-serial")).toBe(headBefore);
    expect(app.container.querySelector("#foot")!.firstElementChild!.getAttribute("data-serial")).toBe(footBefore);

    // Neither was born and neither died — both were simply told their props changed.
    expect(log).toEqual(["updated:alpha", "updated:beta"]);
  });

  test("a key makes the swap a real move, tearing both down", async () => {
    /**
     * The other half: with a `key`, identity is what the author asserted rather than the position,
     * so the two slots no longer adopt each other's regions. Both are torn down and built again —
     * which is what "the content moved" would have to cost, since nothing carries an instance from
     * one prop to another.
     */
    class Keyed extends Component {
      @state swapped = false;
      render() {
        return (
          <Panel
            head={this.swapped ? <Leaf tag="beta" key="beta" /> : <Leaf tag="alpha" key="alpha" />}
            foot={this.swapped ? <Leaf tag="alpha" key="alpha" /> : <Leaf tag="beta" key="beta" />}
          />
        );
      }
    }

    const app = await getDOM<Keyed>(<Keyed />);
    await app.settle();

    log.length = 0;
    app.instance.swapped = true;
    await app.settle();

    expect(app.container.querySelector("#head")!.firstElementChild!.id).toBe("beta");
    expect(app.container.querySelector("#foot")!.firstElementChild!.id).toBe("alpha");
    // Destroyed before created, and each one exactly once.
    expect(log.filter((entry) => entry.startsWith("destroyed")).sort()).toEqual(["destroyed:alpha", "destroyed:beta"]);
    expect(log.filter((entry) => entry.startsWith("created")).sort()).toEqual(["created:alpha", "created:beta"]);
  });
});
