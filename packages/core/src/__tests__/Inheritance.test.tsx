import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, Hook, state, created } from "../index";

/**
 * Extending a component is a first-class pattern: it is how you reuse behaviour
 * without nesting, and nesting is what would cost an element. So everything a
 * component is made of has to survive `extends` — and none of it may need a
 * constructor, because not writing constructors is the point.
 */
describe("extending a component (no constructor anywhere)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const log: string[] = [];

  class Helper extends Hook<{ tag: string }> {
    value() {
      return this.props.tag;
    }
  }

  @Host("td")
  class BaseCell extends Component<{ label?: string }> {
    @state count = 0;
    baseHook = this.use(Helper, () => ({ tag: "base" }));

    @created initBase() {
      log.push("base");
    }

    decorate(v: string) {
      return v.toUpperCase();
    }

    render() {
      return <span>{this.decorate(this.props.label ?? "")}</span>;
    }
  }

  @Host("th")
  class FancyCell extends BaseCell {
    @state extra = 7;
    ownHook = this.use(Helper, () => ({ tag: "fancy" }));

    @created initFancy() {
      log.push("fancy");
    }

    newMethod() {
      return `new:${this.extra}`;
    }

    override decorate(v: string) {
      return `«${super.decorate(v)}»`;
    }

    override render() {
      return (
        <span>
          {this.decorate(this.props.label ?? "")}/{this.newMethod()}/{this.baseHook.value()}
          {this.ownHook.value()}
        </span>
      );
    }
  }

  test("@Host, render, methods, state and hooks all inherit or override", async () => {
    log.length = 0;

    @Host("div")
    class App extends Component {
      render() {
        return (
          <table>
            <tbody>
              <tr>
                <BaseCell label="a" />
                <FancyCell label="b" />
              </tr>
            </tbody>
          </table>
        );
      }
    }

    const app = await getDOM(<App />);
    await app.settle();

    const cells = app.container.querySelectorAll("tr > *");

    // @Host on the subclass wins; the base's is not also emitted.
    expect(Array.from(cells).map((c) => c.nodeName)).toEqual(["TD", "TH"]);

    expect(cells[0].textContent).toBe("A");
    // Overridden method with super, a new method, the inherited hook and the
    // subclass's own hook — all from one class body with no constructor.
    expect(cells[1].textContent).toBe("«B»/new:7/basefancy");

    // Lifecycle from both levels runs, base first.
    expect(log).toEqual(["base", "base", "fancy"]);

    const fancy = (cells[1] as Element & { _componentInstance?: FancyCell })._componentInstance!;
    expect(fancy.count).toBe(0); // inherited @state
    expect(fancy.extra).toBe(7); // own @state
  });

  test("an INHERITED method is auto-bound, so handlers keep working", async () => {
    // The regression this exists for. bindMethods used to walk only the
    // instance's own prototype, so a handler the subclass inherited without
    // overriding stayed unbound — and since an exception inside an
    // addEventListener callback never escapes dispatchEvent, the click did
    // nothing at all, with no error anywhere. Inheritance looked fine and was
    // quietly broken.
    @Host("button")
    class BaseButton extends Component {
      @state clicks = 0;
      handleClick() {
        this.clicks++;
      }
      render() {
        return <span onClick={this.handleClick}>{this.clicks}</span>;
      }
    }

    @Host("button")
    class FancyButton extends BaseButton {
      override render() {
        return <span onClick={this.handleClick}>fancy:{this.clicks}</span>;
      }
    }

    @Host("div")
    class App extends Component {
      render() {
        return (
          <div>
            <BaseButton />
            <FancyButton />
          </div>
        );
      }
    }

    const app = await getDOM(<App />);
    await app.settle();

    app.container.querySelectorAll("span")[1].dispatchEvent(new Event("click", { bubbles: true }));
    await app.settle();

    expect(app.container.querySelectorAll("span")[1].textContent).toBe("fancy:1");

    // Detaching it must survive too — that is what passing it as a prop does.
    const fancy = (
      app.container.querySelectorAll("button")[1] as Element & {
        _componentInstance?: FancyButton;
      }
    )._componentInstance!;
    const detached = fancy.handleClick;
    expect(() => detached()).not.toThrow();
    expect(fancy.clicks).toBe(2);
  });

  test("an inherited method on a Hook is auto-bound too", async () => {
    class BaseHook extends Hook {
      greet() {
        return this.constructor.name;
      }
    }
    class ChildHook extends BaseHook {}

    @Host("div")
    class App extends Component {
      hook = this.use(ChildHook);
      render() {
        return <span>{this.hook.greet()}</span>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    const detached = app.instance.hook.greet;
    expect(detached()).toBe("ChildHook");
  });
});
