import { describe, test, expect } from "vitest";
import { Component, Select } from "../index";
import { renderToString } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";

/**
 * A boolean attribute carries no value: the parser reads only whether it is there. So `true` is
 * written as the empty string, which is the spelling HTML gives and the one a browser writes back
 * from `outerHTML`.
 *
 * `disabled="true"` was never broken — the value is ignored either way — but it put a word in every
 * served page that nothing reads, and made markup that did not round-trip.
 */
class Booleans extends Component {
  render() {
    return (
      <div>
        <input id="a" disabled required readonly />
        <input id="b" type="checkbox" checked />
        <Select id="c" multiple value={[]}>
          <option value="x">x</option>
        </Select>
        <video id="d" muted controls autoplay loop />
        <details id="e" open />
      </div>
    );
  }
}

/**
 * The attributes that LOOK boolean and are not. ARIA states are enumerated strings — `aria-hidden`
 * has a meaningful `"false"`, and an empty one is neither — and a `data-*` flag is data something
 * reads back, where `""` and `"true"` are different answers.
 */
class NotBooleans extends Component {
  render() {
    return <div id="n" aria-hidden={true} aria-expanded={false} data-ready={true} />;
  }
}

/** An ARIA state that goes from one answer to the other, which is the shape a disclosure has. */
class Disclosure extends Component {
  @state open = true;
  render() {
    return (
      <button id="b" aria-expanded={this.open} disabled={this.open}>
        toggle
      </button>
    );
  }
}

const withoutMarkers = (html: string) => html.replace(/<!--[^>]*-->/g, "");

const expected =
  '<div><input id="a" disabled="" required="" readonly="">' +
  '<input id="b" type="checkbox" checked="">' +
  '<select id="c" multiple=""><option value="x">x</option></select>' +
  '<video id="d" muted="" controls="" autoplay="" loop=""></video>' +
  '<details id="e" open=""></details></div>';

describe("a boolean attribute is written the way HTML spells it", () => {
  test("the client writes the empty string", async () => {
    const app = await getDOM<Booleans>(<Booleans />);
    await app.settle();
    expect(withoutMarkers(app.container.innerHTML)).toBe(expected);
  });

  /**
   * The same on both sides, which is the half that matters most: a served page and the page the
   * client would have built are compared attribute by attribute during hydration, and two spellings
   * of the same truth read as a mismatch.
   */
  test("and the server writes exactly the same", async () => {
    expect(withoutMarkers(await renderToString(<Booleans />))).toBe(expected);
  });

  test("aria and data keep their word, because something reads it", async () => {
    const app = await getDOM<NotBooleans>(<NotBooleans />);
    await app.settle();
    const node = app.container.querySelector("#n")!;
    expect({
      hidden: node.getAttribute("aria-hidden"),
      expanded: node.getAttribute("aria-expanded"),
      ready: node.getAttribute("data-ready"),
    }).toEqual({ hidden: "true", expanded: "false", ready: "true" });
  });

  /**
   * `false` normally means "take the attribute away", and has to: a boolean attribute is on
   * whenever it is present, so removing it is the only way to turn `disabled` off. An ARIA state
   * has three answers instead of two — `"true"`, `"false"`, and absent for "no such state here" —
   * so the same `false` has to be written rather than obeyed.
   *
   * Both on one element, going the same way at the same time, because the rule is the attribute's
   * NAME and nothing else.
   */
  test("false takes a boolean attribute away and writes an ARIA state", async () => {
    const app = await getDOM<Disclosure>(<Disclosure />);
    await app.settle();
    const button = app.container.querySelector("#b")!;
    const open = { expanded: button.getAttribute("aria-expanded"), disabled: button.getAttribute("disabled") };

    app.instance.open = false;
    await app.settle();

    expect({
      open,
      closed: { expanded: button.getAttribute("aria-expanded"), disabled: button.getAttribute("disabled") },
    }).toEqual({
      open: { expanded: "true", disabled: "" },
      closed: { expanded: "false", disabled: null },
    });
  });
});

describe("the name is what decides, whatever case it is written in", () => {
  /**
   * `setAttribute` lowercases the name it stores, so `readOnly={true}` becomes the attribute
   * `readonly` — and testing the JSX spelling against the list missed it, writing the very
   * `readonly="true"` this rule exists to remove. `checkBooleanAttribute` has always lowercased, so
   * the two disagreed about one name: the diagnostic recognised it and the writer did not.
   *
   * Reached through a SPREAD, because the types reject the camelCase name outright — `RamondaArgs`
   * keys on `Lowercase<string>`, so `autoFocus` is not a property that exists. That is exactly the
   * reach a runtime rule has and a type does not: a spread whose shape is loose, a JavaScript file, a
   * base class widened by a cast.
   */
  test("a camelCase boolean attribute is still written as HTML spells it", async () => {
    const camel: Record<string, unknown> = { readOnly: true, autoFocus: true };
    class Camel extends Component {
      render() {
        return <input id="i" {...camel} />;
      }
    }

    const app = await getDOM<Camel>(<Camel />);
    await app.settle();
    expect((app.container.querySelector("#i") as Element).outerHTML).toBe('<input id="i" readonly="" autofocus="">');
  });
});

describe("an ARIA state a render turns off is still compared across hydration", () => {
  /**
   * `isComparable` used to carry its own copy of "which values render no attribute", under a comment
   * saying it mirrored `isInvisibleOnScreen`. Then the original learned that `aria-expanded={false}`
   * is WRITTEN rather than removed, and the copy did not — so every ARIA state a render turned off
   * went uncompared, and a real divergence on one could not be reported. It now calls the original.
   */
  test("a server saying true and a client saying false is reported", async () => {
    class Server extends Component {
      render() {
        return (
          <button id="b" aria-expanded={true}>
            x
          </button>
        );
      }
    }
    class Client extends Component {
      render() {
        return (
          <button id="b" aria-expanded={false}>
            x
          </button>
        );
      }
    }

    const captured: string[] = [];
    const handler = (event: Event) => captured.push((event as CustomEvent).detail.message as string);
    window.addEventListener("ramonda:dev-log", handler);

    const html = await renderToString(<Server />);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;
    captured.length = 0;

    hydrateRoot(<Client />, container);
    await Promise.resolve();

    window.removeEventListener("ramonda:dev-log", handler);
    const reported = captured.filter((message) => message.includes("RMD007") && message.includes("aria-expanded"));
    container.remove();

    expect(reported.length).toBe(1);
  });
});
