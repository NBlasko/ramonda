import { describe, test, expect, vi, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component, Select, createRef } from "../index";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";

/**
 * A `<select>` is the one element whose own state is not a property of itself: it is which CHILD is
 * chosen. `<Select value={x}>` says that once, on the element that owns the choice, and settles it
 * once the options are in the element — told to the select on the client, written onto the chosen
 * option on the server, which serializes markup and cannot carry a property.
 *
 * The plain `<select>` is refused by the types. `selected` on an option is a CLAIM: HTML keeps the
 * later of two, and gives a select holding none the first option it is handed, so what it means
 * depends on the order the options reached the select. Measured with `b` asked for out of `a b c`:
 * the page showed `c`. `<option>` itself stays an ordinary tag — it has no choice to make.
 */
class Chooser extends Component {
  @state choice = "b";
  render() {
    return (
      <Select id="s" value={this.choice}>
        {["a", "b", "c"].map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
    );
  }
}

const shown = (root: Element) => {
  const select = root.querySelector("#s") as HTMLSelectElement;
  return { value: select.value, index: select.selectedIndex };
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a controlled select shows what the model says", () => {
  test("on the FIRST render, when its options are built with it", async () => {
    const app = await getDOM<Chooser>(<Chooser />);
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "b", index: 1 });
  });

  test("and follows the model afterwards", async () => {
    const app = await getDOM<Chooser>(<Chooser />);
    await app.settle();

    app.instance.choice = "c";
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "c", index: 2 });

    app.instance.choice = "a";
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "a", index: 0 });
  });

  test("a pick by the user is followed, and the model can put it back", async () => {
    class Picked extends Component {
      @state choice = "b";
      pick(e: Event) {
        this.choice = (e.target as HTMLSelectElement).value;
      }
      render() {
        return (
          <Select id="s" value={this.choice} onchange={this.pick}>
            {["a", "b", "c"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        );
      }
    }

    const app = await getDOM<Picked>(<Picked />);
    await app.settle();

    const select = app.container.querySelector("#s") as HTMLSelectElement;
    select.value = "c";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await app.settle();
    expect(app.instance.choice).toBe("c");

    // And a model that refuses the pick puts it back, which is what "controlled" means.
    app.instance.choice = "a";
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "a", index: 0 });
  });

  test("the option a select is showing survives an unrelated re-render", async () => {
    class WithNoise extends Component {
      @state choice = "b";
      @state tick = 0;
      render() {
        return (
          <div data-tick={String(this.tick)}>
            <Select id="s" value={this.choice}>
              {["a", "b", "c"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
        );
      }
    }

    const app = await getDOM<WithNoise>(<WithNoise />);
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "b", index: 1 });

    app.instance.tick = 1;
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "b", index: 1 });
  });

  /**
   * Why the choice is settled on every render rather than only when the value changes.
   *
   * Putting an option into a live select makes HTML settle the selection again from what it can see,
   * so a render that only ADDS an option can move it while the value stood still.
   */
  test("an option that appears later does not take the choice", async () => {
    class Growing extends Component {
      @state options = ["b", "c"];
      render() {
        return (
          <Select id="s" value="b">
            {this.options.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        );
      }
    }

    const app = await getDOM<Growing>(<Growing />);
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "b", index: 0 });

    app.instance.options = ["a", "b", "c"];
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "b", index: 1 });
  });

  /** Where the chosen option sits changes nothing, which is the whole difference from `selected`. */
  test("the chosen option can be anywhere in the list", async () => {
    class Reversed extends Component {
      render() {
        return (
          <Select id="s" value="c">
            {["c", "b", "a"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        );
      }
    }

    const app = await getDOM<Reversed>(<Reversed />);
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "c", index: 0 });
  });

  /**
   * Everything written on `<Select>` reaches the `<select>`, `data-` and `aria-` included.
   *
   * The props proxy has no `ownKeys` trap — a signal is made per KEY as that key is read, which is
   * what lets a component depend on exactly the props it looked at — so `{...this.props}` spreads
   * nothing at all. A wrapper written the obvious way drops every attribute its caller wrote, and
   * this is the test that would catch it.
   */
  test("a Select is transparent: what you write on it lands on the element", async () => {
    class Dressed extends Component {
      @state wide = true;
      render() {
        return (
          <Select
            id="s"
            value="a"
            className={this.wide ? "wide" : "narrow"}
            disabled
            name="pick"
            data-kind="picker"
            aria-label="pick one"
          >
            <option value="a">a</option>
          </Select>
        );
      }
    }

    const app = await getDOM<Dressed>(<Dressed />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;

    expect({
      cls: select.className,
      disabled: select.disabled,
      name: select.name,
      kind: select.getAttribute("data-kind"),
      label: select.getAttribute("aria-label"),
    }).toEqual({ cls: "wide", disabled: true, name: "pick", kind: "picker", label: "pick one" });

    // And it stays transparent: a forwarded prop that changes is followed.
    app.instance.wide = false;
    await app.settle();
    expect(select.className).toBe("narrow");
  });
});

describe("what the server sends for a select", () => {
  test("the chosen option carries it, so a browser shows it before any JS runs", async () => {
    /**
     * A select has no `value` content attribute at all, so the server cannot write the choice where
     * the author wrote it — `value="b"` on a `<select>` is markup a browser ignores. It goes where
     * HTML keeps it, on the chosen option, which is the only half a served page can carry.
     */
    const html = (await renderToString(<Chooser />)).replace(/<!--[^>]*-->/g, "");
    const host = document.createElement("div");
    host.innerHTML = html;

    expect(html).toContain('<option value="b" selected=""');
    expect((host.querySelector("select") as HTMLSelectElement).value).toBe("b");
  });
});

describe("a served select, hydrated", () => {
  test("the reader sees the right option before any JS, and it stays after", async () => {
    const html = await renderToString(<Chooser />);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("b");

    hydrateRoot(<Chooser />, container);
    await Promise.resolve();
    await Promise.resolve();

    const select = container.querySelector("select") as HTMLSelectElement;
    expect({ value: select.value, index: select.selectedIndex }).toEqual({ value: "b", index: 1 });

    container.remove();
  });
});

describe("why attributes go on before the children", () => {
  test("a multiple select keeps every option the model picked", async () => {
    /**
     * The case that decides the ordering. `multiple` changes how a select treats each option AS IT
     * ARRIVES: without it, a select keeps one selection and discards the rest. Measured with the
     * attribute applied after the children, asking for `b` and `c`: the page kept `c` alone.
     *
     * So neither moment is right for everything — `multiple` has to be on before the options and the
     * choice cannot be settled until after them.
     */
    class Multi extends Component {
      @state picked = ["b", "c"];
      render() {
        return (
          <Select id="s" multiple value={this.picked}>
            {["a", "b", "c"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        );
      }
    }

    const app = await getDOM<Multi>(<Multi />);
    await app.settle();

    const select = app.container.querySelector("#s") as HTMLSelectElement;
    expect([...select.selectedOptions].map((option) => option.value)).toEqual(["b", "c"]);

    // And it follows the model afterwards, still keeping more than one.
    app.instance.picked = ["a", "c"];
    await app.settle();
    expect([...select.selectedOptions].map((option) => option.value)).toEqual(["a", "c"]);
  });
});

describe("a caller's own ref", () => {
  /**
   * One element takes one `ref`, and the component needs the element too. Forwarding the caller's
   * onto the tag meant whichever was written last won — and when that was the caller's, the
   * component never saw its own element, `settle` returned on its first line, and no choice was ever
   * applied. Silently, because a select with no answer still shows an option.
   *
   * Three options with the MIDDLE one asked for, because two would pass by accident: the last option
   * is inserted first and a select with no selection takes the first option it is handed.
   */
  test("gets the element, and the choice is still applied", async () => {
    class Own extends Component {
      mine = createRef<HTMLSelectElement>();
      render() {
        return (
          <Select id="s" value="b" ref={this.mine}>
            <option value="a">a</option>
            <option value="b">b</option>
            <option value="c">c</option>
          </Select>
        );
      }
    }

    const app = await getDOM<Own>(<Own />);
    await app.settle();

    expect({
      refPointsAt: app.instance.mine.current,
      shown: shown(app.container),
    }).toEqual({
      refPointsAt: app.container.querySelector("#s"),
      shown: { value: "b", index: 1 },
    });
  });

  test("and the served markup still carries the choice", async () => {
    class Own extends Component {
      mine = createRef<HTMLSelectElement>();
      render() {
        return (
          <Select value="b" ref={this.mine}>
            <option value="a">a</option>
            <option value="b">b</option>
            <option value="c">c</option>
          </Select>
        );
      }
    }

    const html = (await renderToString(<Own />)).replace(/<!--[^>]*-->/g, "");
    expect(html).toContain('<option value="b" selected=""');
  });

  /**
   * A ref must not outlive the node it points at — the rule `releaseDroppedRef` enforces for an
   * element. The framework cannot enforce it here, because the ref ON the element never changes; the
   * one that changes is the caller's, which only this component knows about.
   */
  test("a swapped ref is handed the node, and the dropped one is let go", async () => {
    class Swapping extends Component {
      first = createRef<HTMLSelectElement>();
      second = createRef<HTMLSelectElement>();
      @state useSecond = false;
      render() {
        return (
          <Select id="s" value="b" ref={this.useSecond ? this.second : this.first}>
            <option value="a">a</option>
            <option value="b">b</option>
          </Select>
        );
      }
    }

    const app = await getDOM<Swapping>(<Swapping />);
    await app.settle();
    const element = app.container.querySelector("#s");
    expect([app.instance.first.current, app.instance.second.current]).toEqual([element, null]);

    app.instance.useSecond = true;
    await app.settle();

    expect([app.instance.first.current, app.instance.second.current]).toEqual([null, element]);
    // And the component still has its own element, so the choice is still followed.
    expect(shown(app.container)).toEqual({ value: "b", index: 1 });
  });
});
