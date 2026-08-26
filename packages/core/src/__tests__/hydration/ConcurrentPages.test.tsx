import { describe, test, expect } from "vitest";
import { Component } from "../../base/Component";
import { state, created } from "../../base/decorators";
import { Head } from "../../base/Head";
import { renderPage } from "../../hydration/ssr";

/**
 * Two requests rendering at once, each with a head of its own.
 *
 * A render's head is not its own: `Head` writes into the real `document.head`, and `renderPage`
 * brackets a render with a reset on each side to make one call independent of everything before it.
 * That bracket is the whole of the isolation, and it holds only while nothing else is inside it.
 *
 * Measured before the fix, on the two calls below started together: the FIRST came back with the
 * second page's title and meta, and the second came back with an empty head. Two visitors, one of
 * them served the other's page — the worst shape a fault on a server can take.
 *
 * `RequestConcurrency.test.tsx` is the same question for `requestContext`, whose answer is the
 * synchronous window rather than a turn.
 */

class Page extends Component<{ who: string }> {
  head = this.use(Head, (self: Page) => ({
    title: `Page ${self.props.who}`,
    meta: [{ name: "who", content: self.props.who }],
  }));
  render() {
    return <div id="body">{this.props.who}</div>;
  }
}

/** A render that AWAITS in the middle, which is the shape that lets two overlap at all. */
class SlowPage extends Component<{ who: string }> {
  @state loaded = "";
  head = this.use(Head, (self: SlowPage) => ({
    title: `Page ${self.props.who}`,
    meta: [{ name: "who", content: self.props.who }],
  }));
  @created async load() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.loaded = this.props.who;
  }
  render() {
    return <div id="body">{this.props.who}</div>;
  }
}

describe("two pages rendered at once", () => {
  test("each keeps its own title, meta and body", async () => {
    const [ada, bob] = await Promise.all([renderPage(<Page who="ada" />), renderPage(<Page who="bob" />)]);

    expect(ada.title).toBe("Page ada");
    expect(ada.head).toContain('content="ada"');
    expect(ada.head).not.toContain("bob");
    expect(ada.body).toContain("ada");

    expect(bob.title).toBe("Page bob");
    expect(bob.head).toContain('content="bob"');
    expect(bob.head).not.toContain("ada");
    expect(bob.body).toContain("bob");
  });

  test("and so does a render that awaits in the middle", async () => {
    const [ada, bob] = await Promise.all([renderPage(<SlowPage who="ada" />), renderPage(<SlowPage who="bob" />)]);

    expect([ada.title, bob.title]).toEqual(["Page ada", "Page bob"]);
    expect(ada.head).not.toContain("bob");
    expect(bob.head).not.toContain("ada");
  });

  test("a render that throws does not stop the ones behind it", async () => {
    class Broken extends Component {
      render(): never {
        throw new Error("render boom");
      }
    }

    const results = await Promise.allSettled([
      renderPage(<Broken />),
      renderPage(<Page who="after" />),
      renderPage(<Page who="later" />),
    ]);

    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
    expect(results[2].status).toBe("fulfilled");
    expect((results[1] as PromiseFulfilledResult<{ title: string }>).value.title).toBe("Page after");
    expect((results[2] as PromiseFulfilledResult<{ title: string }>).value.title).toBe("Page later");
  });
});
