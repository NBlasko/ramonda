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

class ByValue extends Component {
  @state choice = "b";
  pick(e: Event) {
    this.choice = (e.target as HTMLSelectElement).value;
  }
  render() {
    return (
      <select id="s" value={this.choice} onchange={this.pick}>
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </select>
    );
  }
}

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
  test("on the FIRST render, said with value on the select", async () => {
    const app = await getDOM<ByValue>(<ByValue />);
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "b", index: 1 });
  });

  test("on the FIRST render, said with selected on the option", async () => {
    const app = await getDOM<ByOption>(<ByOption />);
    await app.settle();
    expect(shown(app.container)).toEqual({ value: "b", index: 1 });
  });

  test("and follows the model afterwards, both ways", async () => {
    for (const Which of [ByValue, ByOption] as const) {
      const app = await getDOM<InstanceType<typeof Which>>(<Which />);
      await app.settle();
      app.instance.choice = "c";
      await app.settle();
      expect(shown(app.container)).toEqual({ value: "c", index: 2 });

      app.instance.choice = "a";
      await app.settle();
      expect(shown(app.container)).toEqual({ value: "a", index: 0 });
      app.unmount();
    }
  });

  test("a pick by the user reaches the model, and the model reasserts itself", async () => {
    const app = await getDOM<ByValue>(<ByValue />);
    await app.settle();

    const select = app.container.querySelector("#s") as HTMLSelectElement;
    select.value = "c";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await app.settle();

    expect(app.instance.choice).toBe("c");
    expect(shown(app.container)).toEqual({ value: "c", index: 2 });

    // And a model that refuses the pick puts the select back, which is what "controlled" means.
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

  test("and so does the value spelling, because the choice is written onto the option", async () => {
    /**
     * `<select>` has no `value` content attribute, so a value said that way had nowhere to go: the
     * markup carried `value="b"`, a browser ignored it, and the reader saw `A` until hydration
     * corrected it — a visible jump on a slow connection.
     *
     * The property cannot carry it either, since `.selected` is not serialized and the server builds
     * its markup by serializing a real DOM. So the choice is written where HTML keeps it, on the
     * option, and the invalid `value` attribute on the select is not written at all.
     */
    const html = (await renderToString(<ByValue />)).replace(/<!--[^>]*-->/g, "");
    const host = document.createElement("div");
    host.innerHTML = html;

    expect(html).toContain('<option value="b" selected');
    // The attribute HTML has no meaning for is gone from the served page.
    expect(html).not.toContain('<select id="s" value=');
    expect((host.querySelector("select") as HTMLSelectElement).value).toBe("b");
  });

  test("a changed choice leaves exactly one option claiming to be selected", async () => {
    /**
     * The attribute is kept in step rather than only added. Two options carrying `selected` would be
     * markup saying something the live DOM does not, and the second render is where that would
     * happen.
     */
    const app = await getDOM<ByValue>(<ByValue />);
    await app.settle();
    app.instance.choice = "c";
    await app.settle();

    const marked = [...app.container.querySelectorAll("option")].filter((option) => option.hasAttribute("selected"));
    expect(marked.map((option) => option.getAttribute("value"))).toEqual(["c"]);
    expect(shown(app.container)).toEqual({ value: "c", index: 2 });
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
    const html = await renderToString(<ByValue />);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    const beforeJs = (container.querySelector("select") as HTMLSelectElement).value;
    expect(beforeJs).toBe("b");

    hydrateRoot(<ByValue />, container);
    await Promise.resolve();

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("b");
    expect(select.selectedIndex).toBe(1);
    // And the markup still says what the DOM does.
    expect(select.querySelector('option[value="b"]')!.hasAttribute("selected")).toBe(true);

    container.remove();
  });
});
