import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, h } from "../index";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * `h` decides what a child IS before the diff ever sees it: which arrays become
 * their own group, what an invalid child does, and what happens when something
 * that is not a tag ends up in tag position.
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
const dump = (c: Element) =>
  Array.from(c.querySelectorAll("li"))
    .map((l) => l.textContent)
    .join(" | ");
const mark = (c: Element, i: number, v: number) => {
  const li = c.querySelectorAll("li")[i] as any;
  li._componentInstance.hits = v;
};

describe("h: children and tags", () => {
  const codes: string[] = [];
  const handler = (e: Event) => {
    const m = (e as CustomEvent).detail?.message as string;
    const code = m?.match(/^\[(RMD\d+)\]/)?.[1];
    if (code) codes.push(code);
  };
  beforeEach(() => {
    codes.length = 0;
    resetDiagnostics();
    window.addEventListener("ramonda:dev-log", handler);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    window.removeEventListener("ramonda:dev-log", handler);
    vi.restoreAllMocks();
  });

  test("an empty array slot does not shift the group after it", async () => {
    @Host("div")
    class C extends Component {
      @state left: string[] = [];
      @state right = ["r1", "r2"];
      render() {
        return (
          <ul>
            {this.left.map((l) => (
              <Chip label={l} />
            ))}
            {this.right.map((r) => (
              <Chip label={r} />
            ))}
          </ul>
        );
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    expect(dump(app.container)).toBe("r1#0 | r2#0");
    mark(app.container, 0, 10);
    mark(app.container, 1, 20);
    await app.settle();

    // The left slot fills. Identifying groups by a COUNT of the non-empty ones
    // made the right group slide from g0 to g1 here, so it lost its region and
    // the left list inherited its DOM nodes: measured "l1#10 | r1#0 | r2#0".
    app.instance.left = ["l1"];
    await app.settle();
    expect(dump(app.container)).toBe("l1#0 | r1#10 | r2#20");

    app.instance.left = [];
    await app.settle();
    expect(dump(app.container)).toBe("r1#10 | r2#20");
  });

  test("an object that is not a vnode is dropped, and the rest survives", async () => {
    @Host("div")
    class C extends Component {
      render() {
        return h("p", null, { nope: true } as never, "text" as never) as never;
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    expect(app.container.textContent).toBe("text");
  });

  test("a function in tag position is reported but still renders", async () => {
    const Fn = (props: { label?: string }) => h("b", null, props.label ?? ("fn" as never)) as never;
    @Host("div")
    class C extends Component {
      render() {
        return h(Fn as never, { label: "hello" }) as never;
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    // TypeScript rejects this at the call site; if it got here the build has no
    // types, and killing the page would help nobody.
    expect(app.container.textContent).toBe("hello");
    expect(codes).toContain("RMD011");
  });

  test("a function tag that throws does not take the page down", async () => {
    const Bad = () => {
      throw new Error("tag boom");
    };
    @Host("div")
    class C extends Component {
      render() {
        return h("div", null, h(Bad as never, null) as never) as never;
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    // An empty host, not a crash. It must be HOST_TAG and not "template": the
    // name goes into the vnode unchanged and the diff compares it to nodeName,
    // which is always uppercase.
    expect(app.container.querySelector("ramonda-host")).not.toBe(null);
  });

  test("something that is not a tag at all falls back to an empty host", async () => {
    @Host("div")
    class C extends Component {
      render() {
        return h(42 as never, null) as never;
      }
    }
    const app = await getDOM<C>(<C />);
    await app.settle();
    expect(app.container.querySelector("ramonda-host")).not.toBe(null);
  });
});
