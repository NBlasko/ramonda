import { describe, test, expect } from "vitest";
import {
  Component,
  Host,
  state,
  create,
  mount,
  destroy,
  onElement,
  watchProp,
  createRef,
  type RamondaNode,
} from "@ramonda/core";
import { render, act, fireEvent, screen, cleanup } from "../index";

class Counter extends Component<{ start?: number }> {
  @state count = 0;

  @create seed() {
    this.count = this.props.start ?? 0;
  }

  @onElement("click") bump() {
    this.count = this.count + 1;
  }

  render(): RamondaNode {
    return <button type="button">count: {this.count}</button>;
  }
}

describe("render", () => {
  test("mounts synchronously — the DOM is ready when it returns", () => {
    const { getByText } = render(<Counter start={2} />);
    // No await. bootstrap builds and mounts, and render's act commits whatever
    // @create wrote, so there is nothing left pending.
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

  test("container.firstChild is the component's own host, with no harness wrapper", () => {
    const { container } = render(<Counter />);
    const first = container.firstChild as HTMLElement;
    expect(first.getAttribute("data-ramonda")).toBe("Counter");
  });

  test("fireEvent commits the render it causes", () => {
    const { getByText } = render(<Counter />);

    fireEvent.click(getByText("count: 0"));

    // The unwrapped @testing-library/dom fireEvent would still read "count: 0"
    // here: dispatch is synchronous, the render it schedules is not.
    expect(getByText("count: 1")).toBeTruthy();
  });

  test("unmount runs @destroy and empties the container", () => {
    const destroyed: string[] = [];

    class Leaky extends Component {
      @destroy bye() {
        destroyed.push("bye");
      }
      render(): RamondaNode {
        return <p>alive</p>;
      }
    }

    const { container, unmount } = render(<Leaky />);
    expect(container.textContent).toBe("alive");

    unmount();

    expect(destroyed).toEqual(["bye"]);
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
      @create init() {
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
    @Host("section")
    class Frame extends Component<{ children?: RamondaNode }> {
      render(): RamondaNode {
        return this.props.children;
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
  test("@create, then render, then @mount — and by @mount the element is in the document", () => {
    const order: string[] = [];
    let connectedAtMount: boolean | undefined;
    const element = createRef<HTMLElement>();

    @Host("div")
    class Probe extends Component {
      @create a() {
        order.push("create");
      }
      @mount b() {
        order.push("mount");
        // The guarantee @mount exists for. A harness that flushed too early
        // would run it while the tree was still detached.
        connectedAtMount = element.current?.isConnected;
      }
      render(): RamondaNode {
        order.push("render");
        return <p>probe</p>;
      }
    }

    render(<Probe ref={element} />);

    expect(order).toEqual(["create", "render", "mount"]);
    expect(connectedAtMount).toBe(true);
  });
});
