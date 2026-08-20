import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { StableProps, state } from "../base/decorators";

/**
 * Children and a JSX element handed over as a prop, which are the same thing wearing two hats.
 *
 * Both arrive in the props bag, and a rendered node is BUILT during the render — so both are a
 * fresh reference every time and props comparison can never match them. Measured here rather than
 * reasoned about, because the number decides what `@ramonda/check` is allowed to report: if a
 * component with children can never be skipped, then a rule reporting `<Panel>text</Panel>` would
 * report nearly every composed element on the page, which is how a rule earns being switched off.
 *
 * | what the parent hands over | renders after mount | after three parent renders |
 * |---|---|---|
 * | `<Panel>text</Panel>` — plain children | 1 | **4** |
 * | `header={<Header />}` — a node as a prop | 1 | **4** |
 * | `view={Header}` — the component CLASS | 1 | **1** |
 * | either, with `@StableProps` on the child | 1 | **1** |
 *
 * The third row is the one worth knowing: a slot taking a component class costs nothing, because a
 * class is the same reference forever. The fourth is the lever — `@StableProps` names props, and
 * `children` is a prop like any other.
 */
let renders = 0;

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

class Slotted extends Component<{ view: unknown }> {
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

describe("children are props, and a node is built every render", () => {
  test("a component given children cannot be skipped", async () => {
    expect(await childRendersOver(owner(() => <Panel>text</Panel>))).toBe(4);
  });

  test("a node handed over as a prop is the same fault", async () => {
    expect(await childRendersOver(owner(() => <Panel header={<Header />} />))).toBe(4);
  });

  /**
   * The shape that costs nothing, and the reason a slot is worth declaring as a class rather than
   * as a node: a class is the same reference for the life of the module.
   */
  test("a component class as a prop is already stable", async () => {
    expect(await childRendersOver(owner(() => <Slotted view={Header} />))).toBe(1);
  });
});

describe("@StableProps names children like any other prop", () => {
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
