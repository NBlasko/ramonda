import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, list, state } from "../index";
import type { RamondaNode, VNode } from "../index";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * A component whose own chrome uses the SAME tag as whatever a caller drops into
 * its slot. This is the shape where a reorder can move state ACROSS the boundary
 * between the caller's content and the component's own elements.
 *
 * Two mechanisms close it, and neither asks the developer for anything:
 *
 * - `list()` makes the caller's list ONE region in the parent's child record, so
 *   the chrome cannot be claimed as a list item.
 * - Every vnode is stamped with the component whose render() built it, and the
 *   diff refuses to match across origins. That covers hand-written slot content
 *   too — and it works whatever prop the JSX arrived through, at any nesting
 *   depth, because it keys off who BUILT the vnode, not how it arrived.
 */

@Host("li")
class Chip extends Component<{ label: string }> {
  @state hits = 0;
  render() {
    return (
      <span>
        {this.props.label}#{this.hits}
      </span>
    );
  }
}

@Host("div")
class Panel extends Component<{ children?: RamondaNode }> {
  render() {
    return (
      <ul>
        <Chip label="HEAD" />
        {this.props.children}
        <Chip label="FOOT" />
      </ul>
    );
  }
}

const HOISTED_A = <Chip label="hoistedA" />;
const HOISTED_B = <Chip label="hoistedB" />;

const dump = (c: Element) =>
  Array.from(c.querySelectorAll("li"))
    .map((li) => li.textContent)
    .join(" | ");

const mark = (c: Element, i: number, v: number) => {
  const li = c.querySelectorAll("li")[i] as Element & {
    _componentInstance?: Chip;
  };
  li._componentInstance!.hits = v;
};

describe("the slot boundary", () => {
  const codes: string[] = [];
  const handler = (e: Event) => {
    const message = (e as CustomEvent).detail?.message as string;
    const code = message?.match(/^\[(RMD\d+)\]/)?.[1];
    if (code) codes.push(code);
  };

  beforeEach(() => {
    codes.length = 0;
    resetDiagnostics();
    window.addEventListener("ramonda:dev-log", handler);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    window.removeEventListener("ramonda:dev-log", handler);
    vi.restoreAllMocks();
  });

  test("a listed slot keeps the component's chrome out of reach", async () => {
    @Host("div")
    class Caller extends Component {
      @state items = [{ l: "a" }, { l: "b" }, { l: "c" }];
      render() {
        return (
          <Panel>
            {list(this.items, (i: { l: string }) => <Chip label={i.l} />)}
          </Panel>
        );
      }
    }

    const app = await getDOM<Caller>(<Caller />);
    await app.settle();
    mark(app.container, 0, 10); // HEAD
    mark(app.container, 4, 40); // FOOT
    await app.settle();

    app.instance.items = [app.instance.items[0], app.instance.items[2]];
    await app.settle();
    expect(dump(app.container)).toBe("HEAD#10 | a#0 | c#0 | FOOT#40");

    app.instance.items = [...app.instance.items].reverse();
    await app.settle();
    expect(dump(app.container)).toBe("HEAD#10 | c#0 | a#0 | FOOT#40");

    // Nothing to report: the boundary is structural, not advisory.
    expect(codes).toEqual([]);
  });

  test("hand-written slot content cannot take the component's own chrome", async () => {
    @Host("div")
    class Caller extends Component {
      @state flipped = false;
      render() {
        const a = <Chip label="a" />;
        const c = <Chip label="c" />;
        return (
          <Panel>
            {this.flipped ? c : a}
            {this.flipped ? a : c}
          </Panel>
        );
      }
    }

    const app = await getDOM<Caller>(<Caller />);
    await app.settle();
    mark(app.container, 0, 10); // HEAD
    mark(app.container, 3, 40); // FOOT
    await app.settle();

    app.instance.flipped = true;
    await app.settle();

    // Before origin stamping this measured "HEAD#10 | c#0 | a#40 | FOOT#0" —
    // FOOT's state walked into the slot.
    expect(dump(app.container)).toBe("HEAD#10 | c#0 | a#0 | FOOT#40");
  });

  test("a single element through a named prop keeps the chrome intact", async () => {
    // Grouping cannot help here: `icon` is one vnode, never an array, so there
    // is no nested structure to preserve. Only the origin stamp separates it
    // from the panel's own <Chip>s. Measured without the stamp:
    // "HEAD#10 | ICON#40 | FOOT#0" — FOOT's state moved onto the icon when it
    // was hidden and shown again.
    @Host("div")
    class IconPanel extends Component<{ icon: VNode | null }> {
      render() {
        return (
          <ul>
            <Chip label="HEAD" />
            {this.props.icon}
            <Chip label="FOOT" />
          </ul>
        );
      }
    }

    @Host("div")
    class Caller extends Component {
      @state show = true;
      render() {
        return <IconPanel icon={this.show ? <Chip label="ICON" /> : null} />;
      }
    }

    const app = await getDOM<Caller>(<Caller />);
    await app.settle();
    mark(app.container, 0, 10); // HEAD
    mark(app.container, 2, 40); // FOOT
    await app.settle();
    expect(dump(app.container)).toBe("HEAD#10 | ICON#0 | FOOT#40");

    app.instance.show = false;
    await app.settle();
    expect(dump(app.container)).toBe("HEAD#10 | FOOT#40");

    app.instance.show = true;
    await app.settle();
    expect(dump(app.container)).toBe("HEAD#10 | ICON#0 | FOOT#40");
  });

  test("a text slot survives the element in front of it being removed", async () => {
    // Text has no tag and no key, so it is the child with the least to match on,
    // and removing the element before it shifts every position after it. Mixed
    // with elements on both sides on purpose.
    @Host("p")
    class TextPanel extends Component<{
      before: RamondaNode;
      children?: RamondaNode;
    }> {
      render() {
        return (
          <span>
            <b>start·</b>
            {this.props.before}
            <em>·middle·</em>
            {this.props.children}
            <b>·end</b>
          </span>
        );
      }
    }

    @Host("div")
    class Caller extends Component {
      @state showBefore = true;
      @state text = "slotted text";
      render() {
        return <TextPanel before={this.showBefore ? <i>·before·</i> : null}>{this.text}</TextPanel>;
      }
    }

    const app = await getDOM<Caller>(<Caller />);
    await app.settle();
    expect(app.container.textContent).toBe("start··before··middle·slotted text·end");

    app.instance.showBefore = false;
    await app.settle();
    expect(app.container.textContent).toBe("start··middle·slotted text·end");

    app.instance.text = "changed text";
    await app.settle();
    expect(app.container.textContent).toBe("start··middle·changed text·end");

    app.instance.showBefore = true;
    await app.settle();
    expect(app.container.textContent).toBe("start··before··middle·changed text·end");
  });

  test("JSX built outside any render is its own group, not a wildcard", async () => {
    // A module-level vnode has no rendering component to be stamped with. It
    // must not therefore match anything — that would leave exactly the elements
    // a developer hoists to module scope as the unprotected ones.
    @Host("div")
    class Caller extends Component {
      @state swap = false;
      render() {
        return <Panel>{this.swap ? HOISTED_B : HOISTED_A}</Panel>;
      }
    }

    const app = await getDOM<Caller>(<Caller />);
    await app.settle();
    mark(app.container, 0, 10); // HEAD
    mark(app.container, 2, 40); // FOOT
    await app.settle();
    expect(dump(app.container)).toBe("HEAD#10 | hoistedA#0 | FOOT#40");

    app.instance.swap = true;
    await app.settle();
    expect(dump(app.container)).toBe("HEAD#10 | hoistedB#0 | FOOT#40");
  });
});
