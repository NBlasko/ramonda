import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { renderToString } from "../hydration/ssr";
import { Component } from "../base/Component";
import { state } from "../base/decorators";

/**
 * `htmlFor` is the twin of `className`, and it used to be missing.
 *
 * `concepts/jsx` states the pair as one rule — `class` and `for` are keywords, so the JSX borrows
 * the DOM property names — and only `className` was implemented. What that produced was measured
 * rather than guessed: `<label htmlFor="a">` rendered `htmlfor="a"`, `label.htmlFor` read `""`, and
 * the label was associated with nothing, in markup that typechecks and looks correct.
 *
 * Both spellings are asserted because both are written: `htmlFor` is what the documentation teaches,
 * and `for` is what somebody who knows HTML reaches for first.
 */
describe("a label's for-attribute", () => {
  test("htmlFor arrives as `for`, and so does `for`", async () => {
    class Form extends Component {
      render() {
        return (
          <div>
            <label htmlFor="a">A</label>
            <label for="b">B</label>
            <input id="a" />
            <input id="b" />
          </div>
        );
      }
    }

    const { container } = await getDOM(<Form />);
    const [first, second] = [...container.querySelectorAll("label")] as HTMLLabelElement[];

    expect(first?.getAttribute("for")).toBe("a");
    expect(first?.getAttribute("htmlfor")).toBeNull();
    expect(second?.getAttribute("for")).toBe("b");

    // The association itself, which is the whole point and the thing that used to be empty.
    expect(first?.htmlFor).toBe("a");
    expect(second?.htmlFor).toBe("b");
  });

  test("the server writes the same attribute", async () => {
    class Form extends Component {
      render() {
        return <label htmlFor="email">Email</label>;
      }
    }

    const html = await renderToString(<Form />);

    expect(html).toContain('for="email"');
    expect(html).not.toContain("htmlfor");
  });

  test("it is removed as `for` when it goes away", async () => {
    class Form extends Component {
      @state named = true;
      render() {
        return this.named ? <label htmlFor="a">A</label> : <label>A</label>;
      }
    }

    const { container, instance } = (await getDOM(<Form />)) as never as {
      container: HTMLElement;
      instance: Form;
    };
    expect(container.querySelector("label")?.getAttribute("for")).toBe("a");

    (instance as unknown as { named: boolean }).named = false;
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Removing it under the JSX's name would leave the real attribute behind — the same no-op
    // `className` documents beside its own removal.
    expect(container.querySelector("label")?.getAttribute("for")).toBeNull();
  });
});
