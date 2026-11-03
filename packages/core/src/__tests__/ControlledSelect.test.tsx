import { describe, test, expect, vi, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component, Select, createRef } from "../index";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";
import { componentAt } from "../core/DiffAndMerge";
import { flushSync } from "../testing";

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

  /**
   * "Controlled" means the model has the last word. A pick is the two events a browser sends for it,
   * `input` and then `change`, and the handler the app wrote reads the user's pick from either. A
   * handler that leaves the value where it was is a refusal, and the select shows the model's choice
   * again as soon as the event is over — not at some later render of the page.
   */
  test.each([
    ["takes it", "c", { value: "c", index: 2 }],
    ["refuses it", "a", { value: "a", index: 0 }],
  ])("an onchange that %s is answered after the pick", async (_how, model, expected) => {
    let read = "";
    class Picked extends Component {
      @state choice = "a";
      pick(event: Event) {
        read = (event.target as HTMLSelectElement).value;
        this.choice = model;
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
    await pickAsABrowserDoes(select, "c");
    await app.settle();

    // The handler saw the user's pick, not a value put back by the `input` before it.
    expect(read).toBe("c");
    expect(shown(app.container)).toEqual(expected);
  });

  /** A handler may be a listener object, as for any element: it is called, and the pick is answered. */
  test("an onchange given as a listener object is called", async () => {
    class Picked extends Component {
      @state choice = "a";
      listener = { handleEvent: (event: Event) => (this.choice = (event.target as HTMLSelectElement).value) };
      render() {
        return (
          <Select id="s" value={this.choice} onchange={this.listener as never}>
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
    await pickAsABrowserDoes(app.container.querySelector("#s") as HTMLSelectElement, "c");
    await app.settle();

    expect(app.instance.choice).toBe("c");
    expect(shown(app.container)).toEqual({ value: "c", index: 2 });
  });

  /** A `value` with no handler is held by a model that never moves: the pick is undone. */
  test("a select with a value and no handler cannot be changed from the page", async () => {
    class Held extends Component {
      @state choice = "a";
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
    const app = await getDOM<Held>(<Held />);
    await app.settle();
    await pickAsABrowserDoes(app.container.querySelector("#s") as HTMLSelectElement, "c");
    await app.settle();

    expect(shown(app.container)).toEqual({ value: "a", index: 0 });
  });

  /**
   * `defaultValue` is where the select starts, and after that it is the user's: a pick stays, the
   * app's handler still runs as a plain listener, and a later `defaultValue` changes nothing.
   */
  test("a defaultValue select starts there and keeps what the user picks", async () => {
    let read = "";
    class Free extends Component {
      @state start = "b";
      note(event: Event) {
        read = (event.target as HTMLSelectElement).value;
      }
      render() {
        return (
          <Select id="s" defaultValue={this.start} onchange={this.note}>
            {["a", "b", "c"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        );
      }
    }
    const app = await getDOM<Free>(<Free />);
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "b", index: 1 });

    await pickAsABrowserDoes(app.container.querySelector("#s") as HTMLSelectElement, "c");
    await app.settle();
    expect(read).toBe("c");
    expect(shown(app.container)).toEqual({ value: "c", index: 2 });

    app.instance.start = "a";
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "c", index: 2 });
  });

  /** The default waits for options it can choose: options that arrive later still start there. */
  test("a defaultValue is applied when the options arrive", async () => {
    class Later extends Component {
      @state options: string[] = [];
      render() {
        return (
          <Select id="s" defaultValue="b">
            {this.options.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        );
      }
    }
    const app = await getDOM<Later>(<Later />);
    await app.settle();
    app.instance.options = ["a", "b", "c"];
    await app.settle();

    expect(shown(app.container)).toEqual({ value: "b", index: 1 });
  });

  /**
   * Options that arrive after a placeholder — "Choose…" first, the countries from a load — still start
   * on the saved choice: the default holds until the user picks.
   */
  test("a defaultValue whose option arrives after a placeholder is applied", async () => {
    class Countries extends Component {
      @state countries: string[] = [];
      render() {
        return (
          <Select id="s" defaultValue="fr">
            <option value="">Choose…</option>
            {this.countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        );
      }
    }
    const app = await getDOM<Countries>(<Countries />);
    await app.settle();
    app.instance.countries = ["de", "fr", "it"];
    await app.settle();

    expect(shown(app.container)).toEqual({ value: "fr", index: 2 });
  });

  /**
   * A browser drains microtasks between the listeners of one event, so a render can land between a
   * pick's `input` and its `change` — `<form oninput>` setting state does it. That render must not
   * write the old value back before `onchange` has read the pick: the field settles after the event.
   */
  test("a render between a pick's input and its change does not undo the pick", async () => {
    let read = "";
    class Sized extends Component {
      @state size = "m";
      @state dirty = false;
      render() {
        return (
          <form oninput={() => (this.dirty = true)}>
            <Select
              id="s"
              value={this.size}
              onchange={(event: Event) => {
                read = (event.target as HTMLSelectElement).value;
                this.size = read;
              }}
            >
              {["s", "m", "l"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </form>
        );
      }
    }
    const app = await getDOM<Sized>(<Sized />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;

    select.value = "l";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    await app.settle();
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await app.settle();

    expect({ read, shown: select.value, model: app.instance.size }).toEqual({ read: "l", shown: "l", model: "l" });
  });

  /**
   * A `multiple` select whose `value` is a new array each render, with the same members, has not
   * moved: a render in the middle of a pick leaves the pick alone, as it does for one array kept.
   */
  test("a multiple select given a fresh array each render keeps a pick made mid-event", async () => {
    let read: string[] = [];
    class Tags extends Component {
      @state picked = ["a"];
      @state dirty = false;
      render() {
        return (
          <form oninput={() => (this.dirty = true)}>
            <Select
              id="s"
              multiple
              value={[...this.picked]}
              onchange={(event: Event) => {
                read = Array.from((event.target as HTMLSelectElement).selectedOptions, (o) => o.value);
                this.picked = read;
              }}
            >
              {["a", "b", "c"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </form>
        );
      }
    }
    const app = await getDOM<Tags>(<Tags />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;

    select.options[1].selected = true;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    await app.settle();
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await app.settle();

    expect(read).toEqual(["a", "b"]);
  });

  /** A form's reset returns a `defaultValue` select to its default, as it does a `TextArea`. */
  test("a reset goes back to the defaultValue", async () => {
    class Sized extends Component {
      render() {
        return (
          <form>
            <Select id="s" name="size" defaultValue="m">
              {["s", "m", "l"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </form>
        );
      }
    }
    const app = await getDOM<Sized>(<Sized />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;
    await pickAsABrowserDoes(select, "l");
    (select.form as HTMLFormElement).reset();

    expect(shown(app.container)).toEqual({ value: "m", index: 1 });
  });

  /**
   * A `defaultValue` that changes after the user picked leaves the pick showing, and is where a reset
   * returns — as a `TextArea`'s does.
   */
  test("a later defaultValue after a pick keeps the pick, and is where a reset goes", async () => {
    class Sized extends Component {
      @state saved = "s";
      render() {
        return (
          <form>
            <Select id="s" name="size" defaultValue={this.saved}>
              {["s", "m", "l"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </form>
        );
      }
    }
    const app = await getDOM<Sized>(<Sized />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;
    await pickAsABrowserDoes(select, "l");
    app.instance.saved = "m";
    await app.settle();
    const shownAfterLoad = select.value;
    (select.form as HTMLFormElement).reset();

    expect({ shownAfterLoad, afterReset: select.value }).toEqual({ shownAfterLoad: "l", afterReset: "m" });
  });

  /**
   * A new `defaultValue` that names no option yet takes the old default off: a reset must not go back
   * to a choice the model no longer says. The new one is written once its option arrives.
   */
  test("a default with no option yet clears the old one", async () => {
    class Saved extends Component {
      @state saved = "a";
      @state options = ["a", "b"];
      render() {
        return (
          <Select id="s" defaultValue={this.saved}>
            {this.options.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        );
      }
    }
    const app = await getDOM<Saved>(<Saved />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;
    app.instance.saved = "z";
    await app.settle();
    const marked = Array.from(select.options, (o) => o.hasAttribute("selected"));
    app.instance.options = ["a", "b", "z"];
    await app.settle();

    expect({ marked, shown: select.value }).toEqual({ marked: [false, false], shown: "z" });
  });

  /** A reset the form's own handler cancels resets nothing: the pick stays the user's. */
  test("a cancelled reset keeps the pick", async () => {
    class Sized extends Component {
      @state saved = "m";
      render() {
        return (
          <form onreset={(event: Event) => event.preventDefault()}>
            <Select id="s" name="size" defaultValue={this.saved}>
              {["s", "m", "l"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </form>
        );
      }
    }
    const app = await getDOM<Sized>(<Sized />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;
    await pickAsABrowserDoes(select, "l");
    (select.form as HTMLFormElement).reset();
    await new Promise((resolve) => setTimeout(resolve, 0));
    app.instance.saved = "s";
    await app.settle();

    expect(select.value).toBe("l");
  });

  /** A pick that happens to equal the default is still the user's: a later default does not move it. */
  test("a pick equal to the default is kept when the default changes", async () => {
    class Sized extends Component {
      @state saved = "m";
      render() {
        return (
          <form>
            <Select id="s" name="size" defaultValue={this.saved}>
              {["s", "m", "l"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </form>
        );
      }
    }
    const app = await getDOM<Sized>(<Sized />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;
    await pickAsABrowserDoes(select, "l");
    await pickAsABrowserDoes(select, "m");
    app.instance.saved = "s";
    await app.settle();

    expect(select.value).toBe("m");
  });

  /** The pick that is put back is the option the user picked, even when another shares its value. */
  test("the pick put back is the very option, not another with its value", async () => {
    class Choose extends Component {
      @state saved = "a";
      render() {
        return (
          <Select id="s" defaultValue={this.saved}>
            <option value="">Choose…</option>
            <option value="a">a</option>
            <option value="b">b</option>
            <option value="" disabled>
              ──
            </option>
          </Select>
        );
      }
    }
    const app = await getDOM<Choose>(<Choose />);
    await app.settle();
    const select = app.container.querySelector("#s") as HTMLSelectElement;
    select.selectedIndex = 0;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    app.instance.saved = "b";
    await app.settle();

    expect(select.selectedIndex).toBe(0);
  });

  /** A `defaultValue` from a load reaches a select nobody has picked in yet. */
  test("a defaultValue that arrives before a pick is applied", async () => {
    class Loading extends Component {
      @state saved: string | undefined = undefined;
      render() {
        return (
          <Select id="s" defaultValue={this.saved}>
            {["a", "b", "c"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        );
      }
    }
    const app = await getDOM<Loading>(<Loading />);
    await app.settle();
    app.instance.saved = "b";
    await app.settle();

    expect(shown(app.container)).toEqual({ value: "b", index: 1 });
  });

  /** A `defaultValue` that arrives after the user picked changes nothing: the select is theirs. */
  test("a defaultValue that arrives after a pick does not move the select", async () => {
    class Loading extends Component {
      @state saved: string | undefined = undefined;
      render() {
        return (
          <Select id="s" defaultValue={this.saved}>
            {["a", "b", "c"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        );
      }
    }
    const app = await getDOM<Loading>(<Loading />);
    await app.settle();
    await pickAsABrowserDoes(app.container.querySelector("#s") as HTMLSelectElement, "c");
    app.instance.saved = "a";
    await app.settle();

    expect(shown(app.container)).toEqual({ value: "c", index: 2 });
  });

  /** Once a `value` has held the select, a `defaultValue` never applies — it is where a select STARTS. */
  test("a value that goes away does not bring the defaultValue in", async () => {
    class Dropping extends Component {
      @state held: string | undefined = "c";
      render() {
        return (
          <Select id="s" value={this.held} defaultValue="a">
            {["a", "b", "c"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        );
      }
    }
    const app = await getDOM<Dropping>(<Dropping />);
    await app.settle();
    app.instance.held = undefined;
    await app.settle();

    expect(shown(app.container)).toEqual({ value: "c", index: 2 });
  });

  /**
   * After a pick the model took, the select is settled — one write — and not rendered again: the one
   * render is the one its new `value` causes.
   */
  test("a taken pick renders the select once", async () => {
    let renders = 0;
    class Counted extends Select {
      override render() {
        renders++;
        return super.render();
      }
    }
    class Picked extends Component {
      @state choice = "a";
      pick(event: Event) {
        this.choice = (event.target as HTMLSelectElement).value;
      }
      render() {
        return (
          <Counted id="s" value={this.choice} onchange={this.pick}>
            {["a", "b", "c"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Counted>
        );
      }
    }
    const app = await getDOM<Picked>(<Picked />);
    await app.settle();
    renders = 0;
    await pickAsABrowserDoes(app.container.querySelector("#s") as HTMLSelectElement, "c");
    await app.settle();

    expect(renders).toBe(1);
    expect(shown(app.container)).toEqual({ value: "c", index: 2 });
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

  test("a defaultValue is carried the same way", async () => {
    class Starting extends Component {
      render() {
        return (
          <Select defaultValue="c">
            {["a", "b", "c"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        );
      }
    }
    const html = (await renderToString(<Starting />)).replace(/<!--[^>]*-->/g, "");
    const host = document.createElement("div");
    host.innerHTML = html;

    expect(html).toContain('<option value="c" selected=""');
    expect((host.querySelector("select") as HTMLSelectElement).value).toBe("c");
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

describe("a served default select, hydrated", () => {
  class Served extends Component<{ multiple: boolean }> {
    render() {
      return (
        <Select defaultValue="b" multiple={this.props.multiple}>
          {["a", "b", "c"].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      );
    }
  }

  // The reader picks before the script arrives — or the browser restores a form's state.
  const pickedBeforeTheScript = async (pick: (select: HTMLSelectElement) => void, multiple = false) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Served multiple={multiple} />);
    const select = container.querySelector("select") as HTMLSelectElement;
    pick(select);

    hydrateRoot(<Served multiple={multiple} />, container);
    await Promise.resolve();
    await Promise.resolve();

    const after = {
      chosen: Array.from(select.selectedOptions, (option) => option.value),
      reset: Array.from(select.options, (option) => option.defaultSelected),
    };
    container.remove();
    return after;
  };

  test("a pick made before hydration stays, and a reset still returns to the default", async () => {
    expect(await pickedBeforeTheScript((select) => (select.value = "a"))).toEqual({
      chosen: ["a"],
      reset: [false, true, false],
    });
    expect(await pickedBeforeTheScript((select) => (select.value = "c"))).toEqual({
      chosen: ["c"],
      reset: [false, true, false],
    });
  });

  test("a multiple select keeps every option the reader picked", async () => {
    const pick = (select: HTMLSelectElement) => {
      select.options[0].selected = true;
      select.options[1].selected = false;
      select.options[2].selected = true;
    };
    expect(await pickedBeforeTheScript(pick, true)).toEqual({ chosen: ["a", "c"], reset: [false, true, false] });
  });
});

describe("a default select whose default moves", () => {
  class Saved extends Component<{ multiple?: boolean }> {
    @state saved = "b";
    render() {
      return (
        <form>
          <Select defaultValue={this.saved} multiple={this.props.multiple}>
            {["a", "b", "c"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </form>
      );
    }
  }

  const after = (select: HTMLSelectElement) => {
    const shown = select.value;
    select.form?.reset();
    return { shown, reset: select.value };
  };

  test("a pick made on the served page before the script stays when the default moves later", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Saved />);
    const select = container.querySelector("select") as HTMLSelectElement;
    select.value = "c";
    hydrateRoot(<Saved />, container);
    await Promise.resolve();
    await Promise.resolve();
    (componentAt(select.form as HTMLFormElement) as Saved).saved = "a";
    flushSync();
    const result = after(select);
    container.remove();
    expect(result).toEqual({ shown: "c", reset: "a" });
  });

  test("after a reset the select is untouched again, and follows the default", async () => {
    const app = await getDOM<Saved>(<Saved />);
    await app.settle();
    const select = app.container.querySelector("select") as HTMLSelectElement;
    select.value = "c";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.form?.reset();
    app.instance.saved = "a";
    await app.settle();
    expect(after(select)).toEqual({ shown: "a", reset: "a" });
  });

  const chosen = (select: HTMLSelectElement) => Array.from(select.selectedOptions, (option) => option.value);
  const pickEach = (select: HTMLSelectElement, values: string[]) => {
    for (const option of Array.from(select.options)) option.selected = values.includes(option.value);
  };

  test("a multiple select keeps a served pick that includes the default", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = await renderToString(<Saved multiple />);
    const select = container.querySelector("select") as HTMLSelectElement;
    // Added to the default, as a ctrl-click does: only the option clicked is touched.
    (select.options[2] as HTMLOptionElement).selected = true;
    hydrateRoot(<Saved multiple />, container);
    await Promise.resolve();
    await Promise.resolve();
    (componentAt(select.form as HTMLFormElement) as Saved).saved = "a";
    flushSync();
    const shown = chosen(select);
    container.remove();
    expect(shown).toEqual(["b", "c"]);
  });

  test("a multiple select reset after a pick that included the default follows the next default", async () => {
    const app = await getDOM<Saved>(<Saved multiple />);
    await app.settle();
    const select = app.container.querySelector("select") as HTMLSelectElement;
    pickEach(select, ["a", "b"]);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.form?.reset();
    app.instance.saved = "c";
    await app.settle();
    expect(chosen(select)).toEqual(["c"]);
  });

  test("a pick after hydration, and after a reset, still stays", async () => {
    const app = await getDOM<Saved>(<Saved />);
    await app.settle();
    const select = app.container.querySelector("select") as HTMLSelectElement;
    select.value = "c";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.form?.reset();
    select.value = "a";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    app.instance.saved = "c";
    await app.settle();
    expect(after(select)).toEqual({ shown: "a", reset: "c" });
  });
});

describe("a default select whose option arrives later", () => {
  class Later extends Component<{ size?: number; first?: "disabled" }> {
    @state options = ["a"];
    render() {
      return (
        <div>
          <Select defaultValue="b" size={this.props.size}>
            <option value="" disabled={this.props.first === "disabled"}>
              Choose…
            </option>
            {this.options.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </div>
      );
    }
  }

  test("untouched, it moves to the default when its option arrives — after a first option nobody can choose, and in a list box", async () => {
    for (const props of [{}, { first: "disabled" as const }, { size: 3 }]) {
      const app = await getDOM<Later>(<Later {...props} />);
      await app.settle();
      const select = app.container.querySelector("select") as HTMLSelectElement;
      app.instance.options = ["a", "b"];
      await app.settle();
      expect({ props, shown: select.value }).toEqual({ props, shown: "b" });
    }
  });
});

describe("a default select left with nothing chosen", () => {
  test("stays with nothing chosen when the default moves", async () => {
    class Blank extends Component {
      @state saved = "b";
      render() {
        return (
          <Select defaultValue={this.saved}>
            {["a", "b", "c"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        );
      }
    }
    const app = await getDOM<Blank>(<Blank />);
    await app.settle();
    const select = app.container.querySelector("select") as HTMLSelectElement;
    select.selectedIndex = -1;
    app.instance.saved = "c";
    await app.settle();
    expect({ index: select.selectedIndex, reset: Array.from(select.options, (o) => o.defaultSelected) }).toEqual({
      index: -1,
      reset: [false, false, true],
    });
  });
});

/** A select nobody sets starts where a served page starts: what HTML makes of its options in order. */
describe("a select with no value and no default", () => {
  // Past the types, as an untyped spread carries it: the option that says it starts chosen.
  const MARKED: Record<string, unknown> = { selected: true };
  class Bare extends Component<{ size?: number; first?: boolean; multiple?: boolean; marked?: boolean }> {
    render() {
      return (
        <div>
          <Select aria-label="Size" size={this.props.size} multiple={this.props.multiple}>
            <option value="a" disabled={this.props.first === false}>
              a
            </option>
            <option value="b" {...(this.props.marked ? MARKED : {})}>
              b
            </option>
            {["c"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </div>
      );
    }
  }

  test("starts on its first option a reader can choose, and a list box on none — as the served page does", async () => {
    const shown: unknown[] = [];
    const served: unknown[] = [];
    for (const props of [{}, { first: false }, { size: 3 }, { multiple: true }, { marked: true }]) {
      const app = await getDOM<Bare>(<Bare {...props} />);
      await app.settle();
      shown.push((app.container.querySelector("select") as HTMLSelectElement).selectedIndex);
      const host = document.createElement("div");
      host.innerHTML = await renderToString(<Bare {...props} />);
      served.push((host.querySelector("select") as HTMLSelectElement).selectedIndex);
    }
    expect({ shown, served }).toEqual({ shown: [0, 1, -1, -1, 1], served: [0, 1, -1, -1, 1] });
  });
});

/** Options that arrive in a select already on the page start it where a served page would. */
describe("a kept select whose options change", () => {
  class Cities extends Component {
    @state cities: string[] = [];
    render() {
      return (
        <div>
          <Select aria-label="City">
            {this.cities.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </div>
      );
    }
  }

  test("starts on the first option that arrives, and on the first of a whole new list", async () => {
    const app = await getDOM<Cities>(<Cities />);
    await app.settle();
    const select = app.container.querySelector("select") as HTMLSelectElement;
    app.instance.cities = ["a1", "a2", "a3"];
    await app.settle();
    const arrived = select.value;
    app.instance.cities = ["b1", "b2", "b3"];
    await app.settle();
    expect({ arrived, replaced: select.value }).toEqual({ arrived: "a1", replaced: "b1" });
  });
});

describe("a select whose options change in two places at once", () => {
  class Two extends Component {
    @state mine = ["a1", "a2"];
    @state all = ["x1", "x2"];
    render() {
      return (
        <div>
          <Select aria-label="Pick">
            <option disabled value="">
              pick
            </option>
            {this.mine.map(optionOf)}
            <option disabled value="-">
              ----
            </option>
            {this.all.map(optionOf)}
          </Select>
        </div>
      );
    }
  }

  test("starts on the first that arrives in the page, as a served page does", async () => {
    const app = await getDOM<Two>(<Two />);
    await app.settle();
    app.instance.mine = ["b1", "b2"];
    app.instance.all = ["y1", "y2"];
    await app.settle();
    expect((app.container.querySelector("select") as HTMLSelectElement).value).toBe("b1");
  });
});

describe("an option's selected written past the types", () => {
  test("is taken off when the render stops saying it", async () => {
    class Spread extends Component {
      @state pick = "b";
      render() {
        return (
          <Select aria-label="Size">
            {["a", "b", "c"].map((v) => (
              <option key={v} value={v} {...({ selected: this.pick === v } as Record<string, unknown>)}>
                {v}
              </option>
            ))}
          </Select>
        );
      }
    }
    const app = await getDOM<Spread>(<Spread />);
    await app.settle();
    for (const next of ["c", "a"]) {
      app.instance.pick = next;
      await app.settle();
    }
    const select = app.container.querySelector("select") as HTMLSelectElement;
    expect(Array.from(select.options, (o) => o.hasAttribute("selected"))).toEqual([true, false, false]);
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
   * Three options with the MIDDLE one asked for, because an end one would pass by accident: a select
   * with no choice applied shows the first option it is handed, which is an end of the list.
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

/** One pick, as a browser sends it: `input`, then `change`, then the task ends. */
async function pickAsABrowserDoes(select: HTMLSelectElement, value: string): Promise<void> {
  select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function optionOf(value: string) {
  return (
    <option key={value} value={value}>
      {value}
    </option>
  );
}
