import { describe, test, expect } from "vitest";
import { getDOM, instanceOf } from "../test/setup";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";
import { Component } from "../base/Component";
import { __h } from "../index";
import { list } from "../base/list";
import { Hook } from "../base/Hook";
import { StableProps, state, watchProp } from "../base/decorators";

/**
 * Children and a JSX element handed over as a prop, which are the same thing wearing two hats.
 *
 * Both arrive in the props bag, and a rendered node is BUILT during the render — a fresh reference
 * every time. They are compared by what they say instead (`helpers/settleMarkup.ts`), so a parent
 * that renders for an unrelated reason does not re-render a child whose markup is unchanged:
 *
 * | what the parent hands over | renders after mount | after three parent renders |
 * |---|---|---|
 * | `<Panel>text</Panel>` — plain children | 1 | **1** |
 * | `header={<Header />}` — a node as a prop | 1 | **1** |
 * | `slots={{ header: <Header /> }}`, `slots={[<Header />]}` | 1 | **1** |
 * | `view={Header}` — the component CLASS | 1 | **1** |
 * | `data={{ a: 1 }}` — a fresh object holding no markup | 1 | **4** |
 *
 * The last row is the boundary, and it is on purpose: only markup is opened. Data compares by
 * reference wherever it is met, including inside markup, because an object changed in place compares
 * equal to the copy made from it — see the tests at the bottom.
 */
let renders = 0;

/** An element vnode's own children array — built by `normalizeChildren`. */
const elementChildren = (node: unknown) => (node as { children: unknown[] }).children;

/** Built once, outside any render. */
const BUILT_OUTSIDE = <b>x</b>;

class Header extends Component<{ text?: string }> {
  render() {
    return <b>{this.props.text ?? "h"}</b>;
  }
}

class Panel extends Component<{ header?: unknown; children?: unknown }> {
  render() {
    renders++;
    return (
      <li>
        {this.props.header as never}
        {this.props.children as never}
      </li>
    );
  }
}

class Slots extends Component<{ slots: unknown }> {
  render() {
    renders++;
    const slots = this.props.slots as { header?: unknown; footer?: unknown } | unknown[];
    return <li>{(Array.isArray(slots) ? slots : [slots.header, slots.footer]) as never}</li>;
  }
}

@StableProps("slots")
class StableSlots extends Slots {}

class Slotted extends Component<{ view: unknown; data?: unknown }> {
  render() {
    renders++;
    return <li>slot</li>;
  }
}

@StableProps("children", "header")
class Settled extends Component<{ header?: unknown; children?: unknown }> {
  render() {
    renders++;
    return (
      <li>
        {this.props.header as never}
        {this.props.children as never}
      </li>
    );
  }
}

/** Renders the given child under a parent whose state moves for an unrelated reason. */
function owner(child: (tick: number) => unknown) {
  return class Owner extends Component {
    @state tick = 0;
    render() {
      return <ul>{child(this.tick) as never}</ul>;
    }
  };
}

/** Mounts, then ticks the parent three times, and answers how many times the child rendered. */
async function childRendersOver(Owner: ReturnType<typeof owner>) {
  renders = 0;
  const dom = await getDOM<InstanceType<typeof Owner>>(<Owner />);
  await dom.settle();

  for (let tick = 1; tick <= 3; tick++) {
    dom.instance.tick = tick;
    await dom.settle();
  }

  const total = renders;
  dom.unmount();
  return total;
}

describe("markup handed down settles when it says the same", () => {
  test("a component given the same children is not rendered again", async () => {
    expect(await childRendersOver(owner(() => <Panel>text</Panel>))).toBe(1);
  });

  test("nor one whose children hold a component with children of its own", async () => {
    // Two `Panel`s render on mount, and none after.
    expect(
      await childRendersOver(
        owner(() => (
          <Panel>
            <Panel>text</Panel>
          </Panel>
        )),
      ),
    ).toBe(2);
  });

  test("nor is one given the same node as a prop", async () => {
    expect(await childRendersOver(owner(() => <Panel header={<Header />} />))).toBe(1);
  });

  /**
   * A slots object or an array of nodes is the APP's object, and the app may change it in place — so it
   * is compared by reference, like any data, and the child declares it with `@StableProps` when it
   * should compare by content. `fresh-object-in-props` reports the literal and says so.
   */
  test("a slots object or an array of nodes is the app's, until the child declares it", async () => {
    expect(await childRendersOver(owner(() => <Slots slots={{ header: <Header />, footer: <b>f</b> }} />))).toBe(4);
    expect(await childRendersOver(owner(() => <Slots slots={[<Header />, <b>f</b>]} />))).toBe(4);
    expect(await childRendersOver(owner(() => <StableSlots slots={{ header: <Header />, footer: <b>f</b> }} />))).toBe(
      1,
    );
  });

  /**
   * The shape that never needed comparing: a class is the same reference for the life of the module.
   */
  test("a component class as a prop is stable by reference", async () => {
    expect(await childRendersOver(owner(() => <Slotted view={Header} />))).toBe(1);
  });

  test("children that change still arrive", async () => {
    renders = 0;
    const Owner = owner((tick) => <Panel header={<Header text={`h-${tick}`} />}>{`text-${tick}`}</Panel>);
    const dom = await getDOM<InstanceType<typeof Owner>>(<Owner />);
    await dom.settle();

    dom.instance.tick = 1;
    await dom.settle();

    expect(renders).toBe(2);
    expect(dom.container.querySelector("li")?.textContent).toBe("h-1text-1");
    dom.unmount();
  });

  /**
   * The same markup from a different builder is not the same markup: a node is reused only for a
   * vnode built where it was (`areSimilarNodes`), so a render would replace it. Settling must not keep
   * it — `<b>` built at module level and the same `<b>` built in `render` are two things.
   */
  test("the same markup built somewhere else renders the child again", async () => {
    class Owner extends Component {
      @state outside = true;
      render() {
        return (
          <ul>
            <Panel>{this.outside ? BUILT_OUTSIDE : <b>x</b>}</Panel>
          </ul>
        );
      }
    }
    const dom = await getDOM<Owner>(<Owner />);
    await dom.settle();
    const before = dom.container.querySelector("b");

    dom.instance.outside = false;
    await dom.settle();

    expect(dom.container.querySelector("b")).not.toBe(before);
    dom.unmount();
  });

  /**
   * A `list()` is the same list only for the same array AND callback: a callback built in the render
   * may close over what changed, and its rows have to be built again.
   */
  test("a list whose callback changed still reaches the page", async () => {
    const rows = ["r"];
    class Owner extends Component {
      @state word = "a";
      render() {
        const word = this.word;
        return (
          <ul>
            <Panel>
              {list(rows, (r: string) => (
                <i>{`${r}-${word}`}</i>
              ))}
            </Panel>
          </ul>
        );
      }
    }
    const dom = await getDOM<Owner>(<Owner />);
    await dom.settle();

    dom.instance.word = "b";
    await dom.settle();

    expect(dom.container.querySelector("i")?.textContent).toBe("r-b");
    dom.unmount();
  });

  /** The same on a page that was served and hydrated: the record adopted from the server's markup. */
  test("a hydrated child given the same children is not rendered again", async () => {
    const Owner = owner(() => (
      <Panel header={<Header />}>
        <b>text</b>
      </Panel>
    ));
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Owner />);

    hydrateRoot(<Owner />, container);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const app = instanceOf<InstanceType<typeof Owner>>(container.firstChild);

    renders = 0;
    app.tick = 1;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(renders).toBe(0);
    expect(container.querySelector("li")?.textContent).toBe("htext");
    container.remove();
  });

  /**
   * Settled even when another prop changed and the child renders anyway: each prop is a signal, and a
   * watch on `children` must not fire because the `count` beside it moved.
   */
  test("a watch on children stays quiet when only another prop changes", async () => {
    let fired = 0;
    class Counted extends Component<{ count: number; children?: unknown }> {
      @watchProp((props: { children?: unknown }) => props.children)
      seen() {
        fired++;
      }
      render() {
        return (
          <li>
            {this.props.count}
            {this.props.children as never}
          </li>
        );
      }
    }
    class Owner extends Component {
      @state n = 0;
      render() {
        return (
          <ul>
            <Counted count={this.n}>
              <b>x</b>
            </Counted>
          </ul>
        );
      }
    }
    const dom = await getDOM<Owner>(<Owner />);
    await dom.settle();
    fired = 0;

    dom.instance.n = 1;
    await dom.settle();

    expect(fired).toBe(0);
    expect(dom.container.querySelector("li")?.textContent).toBe("1x");
    dom.unmount();
  });

  /**
   * A `list()` handed down as a prop of its own is stamped by the child that renders it, and its
   * successor arrives unstamped — the same array and callback are still the same list.
   */
  test("a list() handed down as a prop of its own is not rendered again", async () => {
    const rows = ["a"];
    class Card extends Component<{ footer: unknown }> {
      render() {
        renders++;
        return <li>{this.props.footer as never}</li>;
      }
    }
    class Owner extends Component {
      @state n = 0;
      row(r: string) {
        return <i>{r}</i>;
      }
      render() {
        return (
          <ul>
            <p>{this.n}</p>
            <Card footer={list(rows, this.row)} />
          </ul>
        );
      }
    }
    const dom = await getDOM<Owner>(<Owner />);
    await dom.settle();
    renders = 0;

    dom.instance.n = 1;
    await dom.settle();

    expect(renders).toBe(0);
    expect(dom.container.querySelector("i")?.textContent).toBe("a");
    dom.unmount();
  });

  /**
   * A framework-built array under any other key is the app's to hand around, and is compared by
   * reference — in a development build too, where every array `normalizeChildren` builds is branded,
   * and not only a component's `children` as in production.
   */
  test("a framework-built array under another key is compared by reference in every build", async () => {
    expect(
      await childRendersOver(
        owner(() => (
          <Slotted
            view={Header}
            data={elementChildren(
              <p>
                <b>x</b>
              </p>,
            )}
          />
        )),
      ),
    ).toBe(4);
  });

  /** One budget per key; past it the answer is "different", which renders — never a stale page. */
  test("markup larger than the comparison's budget renders as before", async () => {
    const many = Array.from({ length: 600 }, (_, i) => i);
    expect(
      await childRendersOver(
        owner(() => (
          <Panel>
            {many.map((i) => (
              <i>{i}</i>
            ))}
          </Panel>
        )),
      ),
    ).toBe(4);
  });
});

/**
 * A hook's props are signals one by one, so its markup is settled key by key: `Portal` reconciles its
 * block when `children` changes, and a `children` that says the same must not wake it, whatever else
 * in the bag moved.
 */
describe("a hook's markup settles key by key", () => {
  /**
   * Each key is compared within a budget of its own: a large `a` that is unchanged does not use up
   * what `b` is compared with, so an unchanged `b` stays unchanged. 250 items is measured to fit the
   * budget alone and not twice over.
   */
  test("a large key does not use up the budget of the next", async () => {
    let fired = 0;
    class Watcher extends Hook<{ a?: unknown; b?: unknown; n: number }> {
      @watchProp((props: { b?: unknown }) => props.b)
      changed() {
        fired++;
      }
    }
    const items = Array.from({ length: 250 }, (_, i) => i);
    class Owner extends Component {
      @state tick = 0;
      watcher = this.use(Watcher, () => ({
        a: (
          <div>
            {items.map((i) => (
              <i>{i}</i>
            ))}
          </div>
        ),
        b: (
          <div>
            {items.map((i) => (
              <i>{i}</i>
            ))}
          </div>
        ),
        n: this.tick,
      }));
      render() {
        return <p>{this.tick}</p>;
      }
    }

    const dom = await getDOM<Owner>(<Owner />);
    await dom.settle();
    fired = 0;
    for (let tick = 1; tick <= 3; tick++) {
      dom.instance.tick = tick;
      await dom.settle();
    }
    expect(fired).toBe(0);
  });

  test("a watch on children fires only when the children change", async () => {
    let fired = 0;
    class Watcher extends Hook<{ children?: unknown; n: number }> {
      @watchProp((props: { children?: unknown }) => props.children)
      changed() {
        fired++;
      }
    }
    class Owner extends Component {
      @state tick = 0;
      @state word = "a";
      watcher = this.use(Watcher, () => ({ children: <b>{this.word}</b>, n: this.tick }));
      render() {
        return <p>{this.tick}</p>;
      }
    }

    const dom = await getDOM<Owner>(<Owner />);
    await dom.settle();
    fired = 0;

    dom.instance.tick = 1;
    await dom.settle();
    expect(fired).toBe(0);

    dom.instance.word = "b";
    await dom.settle();
    expect(fired).toBe(1);
    dom.unmount();
  });
});

describe("data is compared by reference, even inside markup", () => {
  /**
   * A vnode is recognised by the origin every vnode carries, not by its `type` alone: a record with a
   * numeric `type` of 6 or 7 is data, and comparing it as markup ignored every field but `name`.
   */
  test("data shaped like a vnode is still data", async () => {
    class Show extends Component<{ item: { type: number; name: string; qty: number } }> {
      render() {
        return <em>{`${this.props.item.name}:${this.props.item.qty}`}</em>;
      }
    }
    class Holder extends Component {
      @state item = { type: 7, name: "Bolt", qty: 1 };
      render() {
        return (
          <ul>
            <Show item={this.item} />
          </ul>
        );
      }
    }
    const dom = await getDOM<Holder>(<Holder />);
    await dom.settle();

    dom.instance.item = { ...dom.instance.item, qty: 2 };
    await dom.settle();

    expect(dom.container.querySelector("em")?.textContent).toBe("Bolt:2");
    dom.unmount();
  });

  /**
   * The case that ruled out opening the app's containers. A column carries markup AND a width; the
   * width is changed in place and the array copied. Opened, the old array already says 200 and equals
   * the copy, and the table would never show it.
   */
  test("columns with markup, changed in place and then copied, reach the page", async () => {
    class Table extends Component<{ cols: { header: unknown; width: number }[] }> {
      render() {
        return <em>{this.props.cols.map((c) => c.width).join(",")}</em>;
      }
    }
    class Holder extends Component {
      @state cols = [{ header: <b>Name</b>, width: 100 }];
      render() {
        return (
          <ul>
            <Table cols={this.cols} />
          </ul>
        );
      }
    }
    const dom = await getDOM<Holder>(<Holder />);
    await dom.settle();

    dom.instance.cols[0].width = 200;
    dom.instance.cols = dom.instance.cols.map((c) => ({ ...c }));
    await dom.settle();

    expect(dom.container.querySelector("em")?.textContent).toBe("200");
    dom.unmount();
  });

  /**
   * `children` the app hands over in the attributes of a direct `__h()` call is the app's own array —
   * JSX, between the tags or as `children={…}`, always goes through `h`'s normalisation, and only
   * that array is opened. Changed in place and copied, the app's array still arrives.
   */
  test("children handed to __h() in its attributes are the app's array", async () => {
    class Holder extends Component {
      @state items = ["a"];
      render() {
        return <ul>{__h(Panel, { children: this.items } as never) as never}</ul>;
      }
    }
    const dom = await getDOM<Holder>(<Holder />);
    await dom.settle();

    dom.instance.items[0] = "b";
    dom.instance.items = [...dom.instance.items];
    await dom.settle();

    expect(dom.container.querySelector("li")?.textContent).toBe("b");
    dom.unmount();
  });

  test("a fresh object that holds no markup renders the child again", async () => {
    expect(await childRendersOver(owner(() => <Slotted view={Header} data={{ a: 1 }} />))).toBe(4);
  });

  /**
   * Why data is never opened. The row is changed IN PLACE and then copied — the immutable update that
   * is supposed to recover from it. Opened, the old row already holds "after" and equals its copy, the
   * children would settle, and `Panel` would never show it.
   */
  test("a row changed in place and then copied reaches the page", async () => {
    class Label extends Component<{ row: { label: string } }> {
      render() {
        return <em>{this.props.row.label}</em>;
      }
    }
    class Holder extends Component {
      @state row = { label: "before" };
      render() {
        return (
          <ul>
            <Panel>
              <Label row={this.row} />
            </Panel>
          </ul>
        );
      }
    }
    const dom = await getDOM<Holder>(<Holder />);
    await dom.settle();

    dom.instance.row.label = "after";
    dom.instance.row = { ...dom.instance.row };
    await dom.settle();

    expect(dom.container.querySelector("em")?.textContent).toBe("after");
    dom.unmount();
  });
});

/**
 * `@StableProps` naming children as well — redundant now, and it has to stay harmless: the
 * declaration and the markup comparison both run, and neither may freeze what really changed.
 */
describe("@StableProps on children as well", () => {
  test("declared children settle, and so does a declared node prop", async () => {
    expect(await childRendersOver(owner(() => <Settled>text</Settled>))).toBe(1);
    expect(await childRendersOver(owner(() => <Settled header={<Header />} />))).toBe(1);
  });

  /**
   * A declaration is not a freeze. The comparison is by CONTENT, so children that really move still
   * reach the child — and past the compare bound an unequal answer is the safe one, which is why
   * content nested deeper than it goes arrives as well.
   */
  test("children that change still arrive", async () => {
    renders = 0;
    const Owner = owner((tick) => <Settled header={<Header text={`h-${tick}`} />}>{`text-${tick}`}</Settled>);
    const dom = await getDOM<InstanceType<typeof Owner>>(<Owner />);
    await dom.settle();

    dom.instance.tick = 1;
    await dom.settle();

    expect(renders).toBe(2);
    expect(dom.container.querySelector("li")?.textContent).toBe("h-1text-1");
    dom.unmount();
  });

  test("content nested deeper than the comparison goes still arrives", async () => {
    renders = 0;
    const Owner = owner((tick) => (
      <Settled>
        <div>
          <div>
            <div>
              <div>
                <span>{`deep-${tick}`}</span>
              </div>
            </div>
          </div>
        </div>
      </Settled>
    ));
    const dom = await getDOM<InstanceType<typeof Owner>>(<Owner />);
    await dom.settle();

    dom.instance.tick = 1;
    await dom.settle();

    expect(dom.container.querySelector("span")?.textContent).toBe("deep-1");
    dom.unmount();
  });
});
