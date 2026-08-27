import { describe, test, expect } from "vitest";
import { Component } from "../index";
import { renderToString } from "../hydration/ssr";
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
        <select id="c" multiple>
          <option value="x">x</option>
        </select>
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
