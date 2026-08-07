import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, created, destroyed } from "../index";

/**
 * `@Host` may take a callback instead of a fixed tag, so the CALLER picks the
 * element: `<Card as="section" />`.
 *
 * The hazard this file exists for: the diff matches a component by its CLASS,
 * and two `<Card>`s with different `as` are the same class. Without the tag
 * taking part in matching, reconciliation hands one's element to the other and
 * the tag is silently wrong — which is the failure mode a hand-written `key`
 * would have papered over only when the developer remembered to write it.
 */

interface CardProps {
  as?: string;
  label?: string;
}

@Host(
  (p: CardProps) => p.as ?? "div",
  (self: Card) => ({
    className: self.props.label,
  }),
)
class Card extends Component<CardProps> {
  render() {
    return <span>{this.props.label ?? ""}</span>;
  }
}

/**
 * The wrapping <div> each App renders. Two levels down, not one: the container
 * holds App's own `<ramonda-host>`, and the div is inside that.
 */
const wrap = (container: HTMLElement) => container.firstElementChild!.firstElementChild!;
const childTags = (container: HTMLElement) => Array.from(wrap(container).children).map((n) => n.tagName);

describe("@Host tag from props", () => {
  test("the caller chooses the host element", async () => {
    class App extends Component {
      render() {
        return (
          <div>
            <Card as="section" label="one" />
          </div>
        );
      }
    }

    const { container } = await getDOM(<App />);
    const card = wrap(container).firstElementChild!;
    expect(card.tagName).toBe("SECTION");
    expect(card.textContent).toBe("one");
  });

  test("omitting the prop falls back to the callback's default", async () => {
    class App extends Component {
      render() {
        return (
          <div>
            <Card label="plain" />
          </div>
        );
      }
    }

    const { container } = await getDOM(<App />);
    expect(wrap(container).firstElementChild!.tagName).toBe("DIV");
  });

  test("siblings of one class can carry different tags", async () => {
    class App extends Component {
      render() {
        return (
          <div>
            <Card as="section" label="a" />
            <Card as="article" label="b" />
          </div>
        );
      }
    }

    const { container } = await getDOM(<App />);
    expect(childTags(container)).toEqual(["SECTION", "ARTICLE"]);
  });

  /**
   * The case the design note called for. Both siblings are the same class, so
   * before the tag joined matching the diff reused position 0's <section> for
   * the item that now wants <article>.
   */
  test("swapping two siblings swaps their tags, not just their text", async () => {
    class App extends Component {
      @state flipped = false;
      render() {
        return (
          <div>
            {this.flipped ? <Card as="article" label="b" /> : <Card as="section" label="a" />}
            {this.flipped ? <Card as="section" label="a" /> : <Card as="article" label="b" />}
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    expect(childTags(app.container)).toEqual(["SECTION", "ARTICLE"]);

    app.instance.flipped = true;
    await app.settle();

    expect(childTags(app.container)).toEqual(["ARTICLE", "SECTION"]);
    expect(wrap(app.container).textContent).toBe("ba");
  });

  /**
   * A tag change on a LIVE component must not mutate the element in place — the
   * host is the component, and rewriting it would keep an instance whose element
   * is no longer the one it was built with. The diff declines the match and a
   * fresh component is built instead.
   */
  test("changing the prop replaces the element rather than retagging it", async () => {
    class App extends Component {
      @state as = "section";
      render() {
        return (
          <div>
            <Card as={this.as} label="x" />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    const before = wrap(app.container).firstElementChild!;
    expect(before.tagName).toBe("SECTION");

    app.instance.as = "article";
    await app.settle();

    const after = wrap(app.container).firstElementChild!;
    expect(after.tagName).toBe("ARTICLE");
    expect(after).not.toBe(before); // a new element, not the old one renamed
    expect(after.textContent).toBe("x");
  });

  /**
   * What a tag change COSTS, measured rather than implied. `<Card as={flag ?
   * "section" : "div"} />` is not a cheap re-render: the instance is discarded
   * exactly as if its `key` had changed, so its @state is gone and its lifecycle
   * runs again.
   *
   * That is the honest price of "the host element is the component", and it is
   * the reason the tag callback should read a prop that rarely changes — an `as`
   * chosen by the caller once, not a value that flips with UI state.
   *
   * Note the ORDER: the replacement's @created runs BEFORE the old instance's
   * @destroyed. Anything acquired in @created that must not overlap with itself —
   * an exclusive lock, a subscription keyed by identity — sees both alive at
   * once. Locked down here because it is the kind of thing a refactor changes by
   * accident.
   */
  test("a tag change discards the instance, its state and its lifecycle", async () => {
    const log: string[] = [];

    @Host((p: { as?: string }) => p.as ?? "div")
    class Counter extends Component<{ as?: string }> {
      @state count = 0;
      @created born() {
        log.push("create");
      }
      @destroyed gone() {
        log.push("destroy");
      }
      bump() {
        this.count++;
      }
      render() {
        return <span>{String(this.count)}</span>;
      }
    }

    class App extends Component {
      @state flag = false;
      render() {
        return (
          <div>
            <Counter as={this.flag ? "section" : "div"} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    const first = wrap(app.container).firstElementChild!;
    const instance = (first as { _componentInstance?: Counter })._componentInstance!;

    instance.bump();
    instance.bump();
    await app.settle();
    expect(wrap(app.container).textContent).toBe("2");
    expect(log).toEqual(["create"]);

    app.instance.flag = true;
    await app.settle();

    const second = wrap(app.container).firstElementChild!;
    expect(second.tagName).toBe("SECTION");
    expect((second as { _componentInstance?: Counter })._componentInstance).not.toBe(instance);
    // The counter is back to 0 — a new component, not the old one retagged.
    expect(wrap(app.container).textContent).toBe("0");
    expect(log).toEqual(["create", "create", "destroy"]);
  });

  test("the reactive props callback still applies to a resolved tag", async () => {
    class App extends Component {
      render() {
        return (
          <div>
            <Card as="section" label="titled" />
          </div>
        );
      }
    }

    const { container } = await getDOM(<App />);
    const card = wrap(container).firstElementChild!;
    expect(card.tagName).toBe("SECTION");
    expect(card.className).toBe("titled");
  });

  test("a static string tag still works and is unaffected", async () => {
    @Host("nav")
    class Menu extends Component {
      render() {
        return <span>menu</span>;
      }
    }
    class App extends Component {
      render() {
        return (
          <div>
            <Menu />
          </div>
        );
      }
    }

    const { container } = await getDOM(<App />);
    const menu = wrap(container).firstElementChild!;
    expect(menu.tagName).toBe("NAV");
    expect(menu.textContent).toBe("menu");
  });
});
