import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state } from "../index";
import type { RamondaNode } from "../index";
import { resetDiagnostics } from "../debug/diagnostics";

function captureDiagnostics() {
  const codes: string[] = [];
  const messages: string[] = [];
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as { message: string };
    const code = detail.message.match(/^\[(RMD\d+)\]/)?.[1];
    if (!code) return;
    codes.push(code);
    messages.push(detail.message);
  };
  window.addEventListener("ramonda:dev-log", handler);
  return {
    codes,
    messages,
    stop: () => window.removeEventListener("ramonda:dev-log", handler),
  };
}

@Host("li")
class Item extends Component<{ label: string }> {
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
    .map((p) => p.textContent)
    .join(" | ");

describe("an array is its own group among its siblings", () => {
  let captured: ReturnType<typeof captureDiagnostics>;

  /**
   * These tests are about REGION ISOLATION — that an array cannot reach past itself and
   * claim a sibling — and several of them are written with unkeyed components on purpose,
   * because that is the shape the isolation has to survive.
   *
   * Unkeyed components built from an array are a separate finding (RMD023: their identity
   * is their position, so anything but growth at the end moves state to the wrong row).
   * Both are true at once, so each test below claims "nothing BUT that".
   */
  const otherCodes = () => captured.codes.filter((code) => code !== "RMD023");

  beforeEach(() => {
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation(() => {});
    captured = captureDiagnostics();
  });

  afterEach(() => {
    captured.stop();
    vi.restoreAllMocks();
  });

  test("growing a list no longer disturbs the sibling after it", async () => {
    // This used to be the damage RMD012 warned about: growing the list shifted
    // everything after it, and a sibling of the same type was claimed by a list
    // item, taking its DOM node and the state on it. The array is now its own
    // group in the parent's child record, so it cannot reach past itself — and
    // the developer writes nothing to get that.
    @Host("div")
    class List extends Component {
      @state items = ["a"];
      render() {
        return (
          <ul>
            {this.items.map((i) => (
              <Item label={i} />
            ))}
            <Item label="FOOT" />
          </ul>
        );
      }
    }

    const app = await getDOM<List>(<List />);
    await app.settle();

    const lis = app.container.querySelectorAll("li");
    const foot = lis[lis.length - 1] as Element & { _componentInstance?: Item };
    foot._componentInstance!.hits = 99;
    await app.settle();
    expect(dump(app.container)).toBe("a#0 | FOOT#99");

    app.instance.items = ["a", "b", "c"];
    await app.settle();

    // Measured before grouping: "a#0 | b#99 | c#0 | FOOT#0" — #99 had migrated
    // off FOOT and onto `b`.
    expect(dump(app.container)).toBe("a#0 | b#0 | c#0 | FOOT#99");
    expect(otherCodes()).toEqual([]);
  });

  test("keys fix it, and then nothing is reported", async () => {
    @Host("div")
    class List extends Component {
      @state items = ["a"];
      render() {
        return (
          <ul>
            {this.items.map((i) => (
              <Item key={i} label={i} />
            ))}
            <Item label="FOOT" />
          </ul>
        );
      }
    }

    const app = await getDOM<List>(<List />);
    await app.settle();

    const lis = app.container.querySelectorAll("li");
    const foot = lis[lis.length - 1] as Element & { _componentInstance?: Item };
    foot._componentInstance!.hits = 99;
    await app.settle();

    app.instance.items = ["a", "b", "c"];
    await app.settle();

    expect(dump(app.container)).toBe("a#0 | b#0 | c#0 | FOOT#99");
    expect(otherCodes()).toEqual([]);
  });

  test("a list with nothing after it is NOT reported", async () => {
    // The measured reason the check is this narrow: Header stays at index 0
    // however the list grows, so nothing can be claimed. An earlier, broader
    // version of this check was rejected for firing here.
    @Host("div")
    class List extends Component {
      @state items = ["a"];
      render() {
        return (
          <ul>
            <Item label="HEAD" />
            {this.items.map((i) => (
              <Item label={i} />
            ))}
          </ul>
        );
      }
    }

    const app = await getDOM<List>(<List />);
    await app.settle();

    const head = app.container.querySelectorAll("li")[0] as Element & {
      _componentInstance?: Item;
    };
    head._componentInstance!.hits = 99;
    await app.settle();

    app.instance.items = ["a", "b", "c"];
    await app.settle();

    // Safe in fact, not just by assumption.
    expect(dump(app.container)).toBe("HEAD#99 | a#0 | b#0 | c#0");
    expect(otherCodes()).toEqual([]);
  });

  test("a trailing child that renders nothing does not count as following", async () => {
    @Host("div")
    class List extends Component {
      @state items = ["a"];
      show = false;
      render() {
        return (
          <ul>
            {this.items.map((i) => (
              <Item label={i} />
            ))}
            {this.show ? <Item label="FOOT" /> : null}
          </ul>
        );
      }
    }

    await getDOM<List>(<List />);
    expect(otherCodes()).toEqual([]);
  });

  test("a caller's unkeyed slot cannot corrupt the Card's own chrome", async () => {
    // The case that made all of this worth doing: the Card author writes correct
    // code and someone else's unkeyed list used to corrupt Card's chrome. Now
    // the caller's array is its own group and Card's <Item> is not in it.
    @Host("div")
    class Card extends Component<{ children?: RamondaNode }> {
      render() {
        return (
          <ul>
            {this.props.children}
            <Item label="FOOT" />
          </ul>
        );
      }
    }

    @Host("div")
    class App extends Component {
      @state items = ["a", "b"];
      render() {
        return (
          <Card>
            {this.items.map((i) => (
              <Item label={i} />
            ))}
          </Card>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    const lis = app.container.querySelectorAll("li");
    (lis[lis.length - 1] as Element & { _componentInstance?: Item })._componentInstance!.hits = 99;
    await app.settle();
    expect(dump(app.container)).toBe("a#0 | b#0 | FOOT#99");

    app.instance.items = ["a", "b", "c"];
    await app.settle();

    expect(dump(app.container)).toBe("a#0 | b#0 | c#0 | FOOT#99");
    expect(otherCodes()).toEqual([]);
  });
});
