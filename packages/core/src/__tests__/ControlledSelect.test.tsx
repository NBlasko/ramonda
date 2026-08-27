import { describe, test, expect, vi, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../base/Component";
import { renderToString } from "../hydration/ssr";

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

  test("the value spelling does NOT, and that gap is named rather than hidden", async () => {
    /**
     * `<select>` has no `value` content attribute, so a value said that way has nowhere to go in
     * markup — the server writes `value="b"` and a browser ignores it, showing the first option
     * until hydration corrects it. HTML expresses a select's choice as `selected` on the option, and
     * that spelling works end to end.
     *
     * Left as it is rather than fixed here: making the server mark the matching option is a change
     * to what the server emits, and this test is what makes the difference between the two spellings
     * visible instead of leaving it to be discovered on a slow connection.
     */
    const html = (await renderToString(<ByValue />)).replace(/<!--[^>]*-->/g, "");
    const host = document.createElement("div");
    host.innerHTML = html;

    expect(html).not.toContain("selected");
    expect((host.querySelector("select") as HTMLSelectElement).value).toBe("a");
  });
});
