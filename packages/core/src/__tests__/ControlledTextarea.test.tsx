import { describe, test, expect, vi, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../index";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";

/**
 * A `<textarea>` keeps its value INSIDE the element, not in an attribute — there is no `value`
 * content attribute on a textarea at all.
 *
 * That is a question of PLACE rather than of moment, which is what separates it from `<select>`. A
 * select's choice is which child is chosen, so it cannot be settled until the children exist, and it
 * took a component to find that moment. A textarea's value is simply written somewhere else, and the
 * children pass does not disturb it: measured across a render that added a sibling, the value stood.
 *
 * So the client is already right — the property is the whole answer there — and only the server had
 * to change. Before this, a served `<textarea value="hello">` reached the reader as an EMPTY field
 * and filled itself in when the bundle arrived.
 */
class Editor extends Component {
  @state text = "hello";
  render() {
    return <textarea id="t" value={this.text} />;
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
   * The text is content, so it is escaped like content. A value carrying markup used to be the
   * shape that turned a rendered field into a live element on the page.
   */
  test("a value carrying markup is escaped, not opened", async () => {
    class Hostile extends Component {
      render() {
        return <textarea id="t" value={'</textarea><img src=x onerror="steal()">'} />;
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

  /**
   * `<textarea value={x}>text</textarea>` says two things about one field. The one written INSIDE the
   * element wins, because that is where HTML keeps a textarea's value and what a browser parsing the
   * same markup by hand would have kept.
   */
  test("a written child wins over a value prop", async () => {
    class Both extends Component {
      render() {
        return (
          <textarea id="t" value="from the prop">
            from the child
          </textarea>
        );
      }
    }

    const html = (await renderToString(<Both />)).replace(/<!--[^>]*-->/g, "");
    expect(served(html).value).toBe("from the child");

    const app = await getDOM<Both>(<Both />);
    await app.settle();
    expect((app.container.querySelector("#t") as HTMLTextAreaElement).textContent).toBe("from the child");
  });

  test("an empty value sends an empty element rather than nothing at all", async () => {
    class Blank extends Component {
      render() {
        return <textarea id="t" value="" />;
      }
    }
    const html = (await renderToString(<Blank />)).replace(/<!--[^>]*-->/g, "");
    expect(served(html).value).toBe("");
  });
});

describe("a served textarea, hydrated", () => {
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

describe("the client is unchanged, which is half the claim", () => {
  test("a controlled textarea follows the model", async () => {
    const app = await getDOM<Editor>(<Editor />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    expect(field.value).toBe("hello");

    app.instance.text = "goodbye";
    await app.settle();
    expect(field.value).toBe("goodbye");
  });

  /**
   * The client builds the same text child, and it must: the two sides have to produce the same tree
   * or hydration reports a mismatch on every textarea an app renders.
   *
   * What it costs is nothing, because the child is the DEFAULT value. The property beside it is what
   * actually drives the field, and once the reader has typed, the default stops driving it at all —
   * so the child cannot fight anybody. This pins both halves moving together.
   */
  test("the text child is the default, and the property is what drives the field", async () => {
    const app = await getDOM<Editor>(<Editor />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;

    expect({ text: field.textContent, value: field.value }).toEqual({ text: "hello", value: "hello" });

    app.instance.text = "goodbye";
    await app.settle();
    expect({ text: field.textContent, value: field.value }).toEqual({ text: "goodbye", value: "goodbye" });

    // And what the reader types wins over the default, which is what makes it a default.
    field.value = "typed";
    expect({ text: field.textContent, value: field.value }).toEqual({ text: "goodbye", value: "typed" });
  });

  /**
   * A render that changes the children AROUND it leaves the value alone — the measurement that said
   * this needed no component. A `<select>` would have moved its selection here.
   */
  test("a sibling appearing beside it changes nothing", async () => {
    class WithSibling extends Component {
      @state extra = false;
      render() {
        return (
          <div>
            <textarea id="t" value="keep" />
            {this.extra ? <span>x</span> : null}
          </div>
        );
      }
    }

    const app = await getDOM<WithSibling>(<WithSibling />);
    await app.settle();
    const field = app.container.querySelector("#t") as HTMLTextAreaElement;
    expect(field.value).toBe("keep");

    app.instance.extra = true;
    await app.settle();
    expect(field.value).toBe("keep");
  });
});
