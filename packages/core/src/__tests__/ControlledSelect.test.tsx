import { describe, test, expect, vi, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../base/Component";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";

/**
 * A `<select>` is the one element whose own state is not a property of itself: it is which CHILD is
 * chosen. Attributes are applied before children, so both ways of saying it arrived too early —
 * `<select value={x}>` set `.value` on a select with no options, and `<option selected={x}>` set an
 * attribute on an option that was not in a select yet.
 *
 * The second failed in a way that is this framework's own doing. `reorderChildren` walks BACKWARDS,
 * so the last option is inserted first, and a select with no selection takes the first option it is
 * handed. An option inserted afterwards carrying `selected` does not take it back. Measured before
 * the fix, with `b` asked for out of `a b c`: the attribute sat on `b`, the PROPERTY sat on `c`, and
 * the page showed `c`. Both spellings, written out or mapped.
 *
 * Nothing in this repository used a `<select>` — no test, no demo, no documentation example — which
 * is why five review rounds went past it.
 */

class ByOption extends Component {
  @state choice = "b";
  render() {
    return (
      <select id="s">
        {["a", "b", "c"].map((v) => (
          <option key={v} value={v} selected={this.choice === v}>
            {v}
          </option>
        ))}
      </select>
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
  test("on the FIRST render, said with selected on the option", async () => {
    const app = await getDOM<ByOption>(<ByOption />);
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "b", index: 1 });
  });

  test("and follows the model afterwards", async () => {
    const app = await getDOM<ByOption>(<ByOption />);
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
          <select id="s" onchange={this.pick}>
            {["a", "b", "c"].map((v) => (
              <option key={v} value={v} selected={this.choice === v}>
                {v}
              </option>
            ))}
          </select>
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
            <select id="s">
              {["a", "b", "c"].map((v) => (
                <option key={v} value={v} selected={this.choice === v}>
                  {v}
                </option>
              ))}
            </select>
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
});

describe("what the server sends for a select", () => {
  test("the option spelling reaches the markup, so a browser shows it before any JS runs", async () => {
    const html = (await renderToString(<ByOption />)).replace(/<!--[^>]*-->/g, "");
    const host = document.createElement("div");
    host.innerHTML = html;

    expect(html).toContain('<option value="b" selected');
    expect((host.querySelector("select") as HTMLSelectElement).value).toBe("b");
  });
});

describe("a served select, hydrated", () => {
  test("the reader sees the right option before any JS, and it stays after", async () => {
    /**
     * The whole point of putting the choice on the option: the page is correct while it is still
     * just markup. Before this, a served select showed the first option and jumped to the right one
     * when the bundle arrived.
     *
     * Adoption gets the same treatment as the build, because it is the other way in — children are
     * adopted after attributes there too. Without that, the page was right for a reason nobody
     * chose: the server's attribute set the option's selectedness while the markup was parsed, the
     * attribute pass then removed the attribute, and what was left agreed with the model by accident.
     */
    const html = await renderToString(<ByOption />);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    const beforeJs = (container.querySelector("select") as HTMLSelectElement).value;
    expect(beforeJs).toBe("b");

    hydrateRoot(<ByOption />, container);
    await Promise.resolve();

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("b");
    expect(select.selectedIndex).toBe(1);
    // And the markup still says what the DOM does.
    expect(select.querySelector('option[value="b"]')!.hasAttribute("selected")).toBe(true);

    container.remove();
  });
});

describe("why attributes go on before the children", () => {
  test("a multiple select keeps every option the model picked", async () => {
    /**
     * The question this answers: could ALL attributes simply be applied after the children, and the
     * second visit disappear? The suite says yes — all 1337 tests pass either way — and the suite is
     * wrong, in the same way it was wrong about `<select>` until an hour ago: nothing exercised the
     * case that decides it.
     *
     * `multiple` is that case. It changes how a select treats each option AS IT ARRIVES: without it,
     * a select keeps one selection and discards the rest. Measured with the attribute applied after
     * the children, asking for `b` and `c`: the page kept `c` alone.
     *
     * So neither ordering is right for everything — `multiple` has to be on before the options and
     * `value` cannot be until after them — and two passes is the shape that follows, rather than a
     * workaround for one element.
     */
    class Multi extends Component {
      @state picked = ["b", "c"];
      render() {
        return (
          <select id="s" multiple>
            {["a", "b", "c"].map((v) => (
              <option key={v} value={v} selected={this.picked.includes(v)}>
                {v}
              </option>
            ))}
          </select>
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
