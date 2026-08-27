import { describe, test, expect } from "vitest";
import { Component, state, created, mounted, destroyed, watchProp, createRef, type RamondaNode } from "@ramonda/core";
import { render, act, fireEvent, screen, cleanup } from "../index";

class Counter extends Component<{ start?: number }> {
  @state count = 0;

  @created seed() {
    this.count = this.props.start ?? 0;
  }

  bump() {
    this.count = this.count + 1;
  }

  render(): RamondaNode {
    return (
      <button type="button" onclick={this.bump}>
        count: {this.count}
      </button>
    );
  }
}

describe("render", () => {
  test("mounts synchronously — the DOM is ready when it returns", () => {
    const { getByText } = render(<Counter start={2} />);
    // No await. bootstrap builds and mounts, and render's act commits whatever
    // @created wrote, so there is nothing left pending.
    expect(getByText("count: 2")).toBeTruthy();
  });

  test("hands back the root instance so state can be driven directly", () => {
    const { instance, getByText } = render<Counter>(<Counter />);

    act(() => {
      instance.count = 41;
    });

    expect(getByText("count: 41")).toBeTruthy();
  });

  test("queries are bound to document.body, so screen finds the same nodes", () => {
    render(<Counter start={7} />);
    expect(screen.getByText("count: 7")).toBeTruthy();
  });

  test("container.firstChild is the component's own markup, with no harness wrapper", () => {
    const { container } = render(<Counter />);

    /**
     * The component's own element, and nothing of the harness or the framework around it.
     *
     * It used to be the host — `<ramonda-host data-ramonda="Counter">` — and the assertion read
     * that DEV attribute. A component owns a range and renders its own markup, so what the
     * container holds is exactly what `Counter.render()` returned.
     */
    expect((container.firstChild as HTMLElement).tagName).toBe("BUTTON");
    expect(container.childNodes).toHaveLength(1);
  });

  test("fireEvent commits the render it causes", () => {
    const { getByText } = render(<Counter />);

    fireEvent.click(getByText("count: 0"));

    // The unwrapped @testing-library/dom fireEvent would still read "count: 0"
    // here: dispatch is synchronous, the render it schedules is not.
    expect(getByText("count: 1")).toBeTruthy();
  });

  test("unmount runs @destroyed and empties the container", () => {
    const destroyedOrder: string[] = [];

    class Leaky extends Component {
      @destroyed bye() {
        destroyedOrder.push("bye");
      }
      render(): RamondaNode {
        return <p>alive</p>;
      }
    }

    const { container, unmount } = render(<Leaky />);
    expect(container.textContent).toBe("alive");

    unmount();

    expect(destroyedOrder).toEqual(["bye"]);
    expect(container.childNodes.length).toBe(0);
  });

  test("asFragment snapshots the container's content", () => {
    const { asFragment } = render(<Counter start={3} />);
    const fragment = asFragment();
    expect(fragment.textContent).toContain("count: 3");
  });
});

describe("rerender", () => {
  test("diffs: the instance and its state survive new props", () => {
    const creates: string[] = [];

    class Card extends Component<{ title: string }> {
      @state hits = 0;
      @created init() {
        creates.push("create");
      }
      render(): RamondaNode {
        return (
          <p>
            {this.props.title}:{this.hits}
          </p>
        );
      }
    }

    const { instance, rerender, getByText } = render<Card>(<Card title="a" />);

    act(() => {
      instance.hits = 7;
    });
    expect(getByText("a:7")).toBeTruthy();

    rerender(<Card title="b" />);

    // A rerender that unmounted and remounted would show "b:0" and two creates.
    expect(getByText("b:7")).toBeTruthy();
    expect(creates).toEqual(["create"]);
  });

  test("@watchProp fires on the new props, as it would under a real parent", () => {
    const seen: string[] = [];

    class Watcher extends Component<{ userId: string }> {
      @watchProp((p: { userId: string }) => p.userId)
      reload([next]: [string], [previous]: [string]) {
        seen.push(`${previous}->${next}`);
      }
      render(): RamondaNode {
        return <p>{this.props.userId}</p>;
      }
    }

    const { rerender } = render(<Watcher userId="u1" />);
    expect(seen).toEqual([]);

    rerender(<Watcher userId="u2" />);
    expect(seen).toEqual(["u1->u2"]);
  });
});

describe("options", () => {
  test("a wrapper component sits above the tree", () => {
    class Frame extends Component<{ children?: RamondaNode }> {
      render(): RamondaNode {
        return <section>{this.props.children}</section>;
      }
    }

    const { container, getByText } = render(<Counter start={1} />, {
      wrapper: Frame,
    });

    expect(container.querySelector("section")).toBeTruthy();
    expect(getByText("count: 1")).toBeTruthy();
  });

  test("a supplied container is used and NOT removed on cleanup", () => {
    const mine = document.createElement("main");
    document.body.appendChild(mine);

    render(<Counter />, { container: mine });
    expect(mine.textContent).toContain("count: 0");

    cleanup();

    // Emptied — the components really were unmounted — but still in the
    // document, because the caller owns it.
    expect(mine.childNodes.length).toBe(0);
    expect(mine.isConnected).toBe(true);
    mine.remove();
  });
});

describe("lifecycle ordering is preserved through the harness", () => {
  test("@created, then render, then @mounted — and by @mounted the element is in the document", () => {
    const order: string[] = [];
    let connectedAtMount: boolean | undefined;
    const element = createRef<HTMLElement>();

    class Probe extends Component {
      @created a() {
        order.push("create");
      }
      @mounted b() {
        order.push("mount");
        // The guarantee @mounted exists for. A harness that flushed too early
        // would run it while the tree was still detached.
        connectedAtMount = element.current?.isConnected;
      }
      render(): RamondaNode {
        order.push("render");
        return (
          // The ref goes on the ELEMENT it means. A component takes none: it owns a range of nodes
          // rather than one, so there is no single element for a ref on the tag to point at.
          <div ref={element}>
            <p>probe</p>
          </div>
        );
      }
    }

    render(<Probe />);

    expect(order).toEqual(["create", "render", "mount"]);
    expect(connectedAtMount).toBe(true);
  });
});
