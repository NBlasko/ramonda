import { describe, test, expect, vi, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component, TextArea, createRef } from "../index";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";

/**
 * A `<textarea>` keeps its value INSIDE the element. HTML gives it no `value` attribute at all, so
 * `<textarea value="hello">` is markup a browser ignores — measured on the parsed output, an EMPTY
 * field that filled itself in when the bundle arrived.
 *
 * `<TextArea value={x}>` writes it as the element's child instead, which is the one place it
 * survives. The attribute pass cannot: it runs BEFORE the children, so a text node written there is
 * one the children pass has never heard of, and it unmounts it as a leftover — measured, `"hello"`
 * at the moment of writing and `<textarea></textarea>` in the finished markup.
 *
 * The plain tag is refused by the types for that reason: nothing written as an attribute can carry
 * this value, and only something that renders the tag can write a child.
 */
class Editor extends Component {
  @state text = "hello";
  render() {
    return <TextArea id="t" value={this.text} />;
  }
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const served = (html: string): HTMLTextAreaElement => {
  const host = document.createElement("div");
  host.innerHTML = html.replace(/<!--[^>]*-->/g, "");
  return host.querySelector("textarea") as HTMLTextAreaElement;
};

describe("what the server sends for a textarea", () => {
  test("the value is inside the element, so a browser shows it before any JS runs", async () => {
    const html = (await renderToString(<Editor />)).replace(/<!--[^>]*-->/g, "");
    expect(html).toBe('<textarea id="t">hello</textarea>');
    expect(served(html).value).toBe("hello");
  });

  /**
   * The value is content now, so it is escaped like content. Written as an attribute it was escaped
   * for a different context entirely, and a value carrying markup is the shape that turns a rendered
   * field into a live element on somebody's page.
   */
  test("a value carrying markup is escaped, not opened", async () => {
    class Hostile extends Component {
      render() {
        return <TextArea id="t" value={'</textarea><img src=x onerror="steal()">'} />;
      }
    }

    const html = (await renderToString(<Hostile />)).replace(/<!--[^>]*-->/g, "");
    const host = document.createElement("div");
    host.innerHTML = html;

    expect(host.querySelectorAll("img").length).toBe(0);
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      '</textarea><img src=x onerror="steal()">',
    );
  });

  test("an empty value sends an empty element rather than nothing at all", async () => {
    class Blank extends Component {
      render() {
        return <TextArea id="t" value="" />;
      }
    }
    const html = (await renderToString(<Blank />)).replace(/<!--[^>]*-->/g, "");
    expect(served(html).value).toBe("");
  });
});

describe("a served textarea, hydrated", () => {
  /**
   * An EMPTY value is no child at all, not a child that is the empty string.
   *
   * The two look identical in the DOM and are not the same tree: the server has nothing to
   * serialize for `""`, so it sends `<textarea></textarea>`, and a client that built an empty text
   * node disagrees with it. It reported RMD007 — *rendered the text "" but the server sent nothing*
   * — on markup both sides were right about, which is the worst kind of report to get.
   */
  test("an empty value is not a mismatch", async () => {
    class Blank extends Component {
      render() {
        return <TextArea id="t" value="" />;
      }
    }

    const captured: string[] = [];
    const handler = (event: Event) => captured.push((event as CustomEvent).detail.message as string);
    window.addEventListener("ramonda:dev-log", handler);

    const html = await renderToString(<Blank />);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;
    captured.length = 0;

    hydrateRoot(<Blank />, container);
    await Promise.resolve();

    window.removeEventListener("ramonda:dev-log", handler);
    const field = container.querySelector("#t") as HTMLTextAreaElement;
    const result = { value: field.value, reported: captured.filter((m) => m.includes("RMD")) };
    container.remove();

    expect(result).toEqual({ value: "", reported: [] });
  });

  test("the reader sees the text before any JS, and it stays after", async () => {
    const html = await renderToString(<Editor />);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    expect((container.querySelector("#t") as HTMLTextAreaElement).value).toBe("hello");

    hydrateRoot(<Editor />, container);
    await Promise.resolve();
    await Promise.resolve();

    expect((container.querySelector("#t") as HTMLTextAreaElement).value).toBe("hello");
    container.remove();
  });
});

describe("a controlled textarea on the client", () => {
  test("follows the model", async () => {
    const app = await getDOM<Editor>(<Editor />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    expect(field.value).toBe("hello");

    app.instance.text = "goodbye";
    await app.settle();
    expect(field.value).toBe("goodbye");
  });

  /**
   * Both halves move together, and the reason they are two halves at all.
   *
   * The child is the DEFAULT value — what the field starts as, and the only thing a served page can
   * carry. The property is what the field IS, and once the reader has typed, the default has stopped
   * driving the element entirely: from then on only the property can put the model back.
   */
  test("the child is the default and the property is what drives the field", async () => {
    const app = await getDOM<Editor>(<Editor />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    expect({ text: field.textContent, value: field.value }).toEqual({ text: "hello", value: "hello" });

    app.instance.text = "goodbye";
    await app.settle();
    expect({ text: field.textContent, value: field.value }).toEqual({ text: "goodbye", value: "goodbye" });

    // What the reader types wins over the default, which is what makes it a default.
    field.value = "typed";
    expect({ text: field.textContent, value: field.value }).toEqual({ text: "goodbye", value: "typed" });
  });

  /** Everything else written on it reaches the element, `data-` and `aria-` included. */
  test("it is transparent", async () => {
    class Dressed extends Component {
      @state wide = true;
      render() {
        return (
          <TextArea
            id="t"
            value="x"
            className={this.wide ? "wide" : "narrow"}
            disabled
            name="notes"
            rows={4}
            data-kind="editor"
            aria-label="notes"
          />
        );
      }
    }

    const app = await getDOM<Dressed>(<Dressed />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    expect({
      cls: field.className,
      disabled: field.disabled,
      name: field.name,
      rows: field.rows,
      kind: field.getAttribute("data-kind"),
      label: field.getAttribute("aria-label"),
    }).toEqual({ cls: "wide", disabled: true, name: "notes", rows: 4, kind: "editor", label: "notes" });

    app.instance.wide = false;
    await app.settle();
    expect(field.className).toBe("narrow");
  });

  /**
   * A caller's own ref, which on `Select` was the bug that silently stopped the component working:
   * one element takes one `ref`, and if the caller's wins, the component never sees its element.
   */
  test("a caller's ref gets the element, and the value is still applied", async () => {
    class Own extends Component {
      mine = createRef<HTMLTextAreaElement>();
      render() {
        return <TextArea id="t" value="held" ref={this.mine} />;
      }
    }

    const app = await getDOM<Own>(<Own />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    expect({ ref: app.instance.mine.current, value: field.value }).toEqual({ ref: field, value: "held" });
  });
});

/**
 * A caller's own ref, and the one case the component's own comment promises and does not keep.
 *
 * `TextArea` takes the element's `ref` for itself — one element takes one ref, and a component that
 * loses its own element stops being able to drive it — so the caller's is handed the node by hand,
 * in `g()`. `settle()` re-checks it on every update because "a caller may hand over a DIFFERENT ref
 * between renders, and the element's own ref did not change, so nothing else would notice. This is
 * the one moment that can."
 *
 * **Measured: that moment does not arrive on the swap itself.** `helpers/arePropsBagsEqual.ts`
 * ignores `ref` on purpose — an inline `ref={createRef()}` would otherwise re-render the child on
 * every parent render, one wasted render each, measured — so a render whose ONLY change is the ref
 * is not a props change at all. The component is never queued, `rawProps` is not even replaced, and
 * `settle` does not run. The swap is honoured by the NEXT update, whatever causes it.
 *
 * `Select` has the identical code and passes its own version of this test, which is why it went
 * unnoticed: its children are rebuilt on every parent render, so it always has another reason to
 * update. Probed with the same child vnodes handed over each time — still passes, because the
 * framework rebuilds the children array regardless. `TextArea` with an unchanged value has nothing.
 *
 * These tests pin what it DOES, and the gap is named rather than papered over: the premise
 * `arePropsBagsEqual` states for ignoring `ref` — "pointed at the host element when the component
 * is created and never read again" — stopped being true when these two components were written to
 * hand the caller's ref over themselves.
 */
describe("a caller's own ref on a textarea", () => {
  class Swapping extends Component {
    first = createRef<HTMLTextAreaElement>();
    second = createRef<HTMLTextAreaElement>();
    @state useSecond = false;
    @state text = "hello";
    render() {
      return <TextArea id="t" value={this.text} ref={this.useSecond ? this.second : this.first} />;
    }
  }

  test("gets the element, and the value is still applied", async () => {
    const app = await getDOM<Swapping>(<Swapping />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    expect(app.instance.first.current).toBe(field);
    expect(app.instance.second.current).toBeNull();
    // The component kept its own element, so the model still drives the field.
    expect(field.value).toBe("hello");
  });

  test("a swap alone is not a props change, so the old ref still holds the node", async () => {
    const app = await getDOM<Swapping>(<Swapping />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    app.instance.useSecond = true;
    await app.settle();

    // Not what the comment in `TextArea` promises, and this is the measurement of it.
    expect(app.instance.first.current).toBe(field);
    expect(app.instance.second.current).toBeNull();
    // The element itself is untouched: it was never re-rendered, so nothing moved.
    expect(app.container.querySelector("#t")).toBe(field);
    expect(field.value).toBe("hello");
  });

  test("and the next update honours it — the dropped ref is let go, the new one is handed the node", async () => {
    const app = await getDOM<Swapping>(<Swapping />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    app.instance.useSecond = true;
    await app.settle();
    // Anything at all that changes the props: here the model, which is the ordinary case.
    app.instance.text = "again";
    await app.settle();

    expect(app.instance.first.current).toBeNull();
    expect(app.instance.second.current).toBe(field);
    expect(field.value).toBe("again");
  });
});
