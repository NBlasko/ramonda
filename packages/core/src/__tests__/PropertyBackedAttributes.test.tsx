import { describe, test, expect } from "vitest";
import { Component } from "../index";
import { state } from "../base/decorators";
import { getDOM } from "../test/setup";
import { renderToString } from "../hydration/ssr";

/**
 * Three attributes whose truth is a PROPERTY, and one rule that decides whether the attribute beside
 * it is worth writing at all.
 *
 * An attribute is the state an element STARTED with. For most elements that is the whole story, and
 * the two never disagree. For these it is not: `checked` and `muted` stop driving the element the
 * moment a user touches it, and `indeterminate` has no attribute in the first place. So the property
 * is written as well — or instead, where HTML has nothing to write.
 */
class Media extends Component {
  @state quiet = true;
  render() {
    return <video id="v" muted={this.quiet} />;
  }
}

class Mixed extends Component {
  @state partial = true;
  render() {
    return <input id="c" type="checkbox" indeterminate={this.partial} />;
  }
}

describe("muted on a media element", () => {
  /**
   * The attribute alone was not enough, and this is what it cost: `<video muted autoplay>` went out
   * with `.muted === false`, and a browser refuses to autoplay a video that is not muted. The
   * element was written exactly as asked and did not play.
   */
  test("the property says what the attribute says", async () => {
    const app = await getDOM<Media>(<Media />);
    await app.settle();
    const video = app.container.querySelector("#v") as HTMLVideoElement;
    expect({ property: video.muted, attribute: video.getAttribute("muted") }).toEqual({
      property: true,
      attribute: "",
    });
  });

  /**
   * And off again. Removing the attribute cannot turn it off once the element is live — that is the
   * whole reason the property is written — so a model that says `false` has to say it in the one
   * place the element is still listening to.
   */
  test("and turns off with the model, not just in the markup", async () => {
    const app = await getDOM<Media>(<Media />);
    await app.settle();
    const video = app.container.querySelector("#v") as HTMLVideoElement;

    app.instance.quiet = false;
    await app.settle();
    expect({ property: video.muted, attribute: video.getAttribute("muted") }).toEqual({
      property: false,
      attribute: null,
    });
  });

  test("a served video carries it, because the attribute is the default state", async () => {
    const html = (await renderToString(<Media />)).replace(/<!--[^>]*-->/g, "");
    expect(html).toBe('<video id="v" muted=""></video>');
  });
});

describe("indeterminate on a checkbox", () => {
  /**
   * The third state exists ONLY as a property: HTML has no `indeterminate` attribute. Before this,
   * one was written anyway — `indeterminate="true"` sat in the markup, nothing read it, and the box
   * showed plainly unchecked.
   */
  test("the property is set and no attribute is invented", async () => {
    const app = await getDOM<Mixed>(<Mixed />);
    await app.settle();
    const box = app.container.querySelector("#c") as HTMLInputElement;
    expect({ property: box.indeterminate, attribute: box.getAttribute("indeterminate") }).toEqual({
      property: true,
      attribute: null,
    });
  });

  test("and clears with the model", async () => {
    const app = await getDOM<Mixed>(<Mixed />);
    await app.settle();
    const box = app.container.querySelector("#c") as HTMLInputElement;

    app.instance.partial = false;
    await app.settle();
    expect(box.indeterminate).toBe(false);
  });

  /**
   * What a served page cannot say, written down so nobody looks for it twice. HTML gives this state
   * no markup, so the box arrives unchecked and becomes mixed when hydration sets the property.
   */
  test("a served page carries no trace of it, because HTML has nowhere to put it", async () => {
    const html = (await renderToString(<Mixed />)).replace(/<!--[^>]*-->/g, "");
    expect(html).toBe('<input id="c" type="checkbox">');
  });
});

describe("an attribute HTML does not have is not written", () => {
  /**
   * One rule with a table behind it, rather than a branch per tag. Each of these names is real HTML
   * somewhere else, which is what makes them worth writing down: `value` is right on an `<input>`
   * and meaningless on a `<textarea>` and a `<select>`, whose values are their children.
   */
  test("the same name is written where it exists and skipped where it does not", async () => {
    class Both extends Component {
      render() {
        return (
          <div>
            <input id="i" value="written" />
            <textarea id="t" value="skipped" />
          </div>
        );
      }
    }

    const app = await getDOM<Both>(<Both />);
    await app.settle();
    const input = app.container.querySelector("#i") as HTMLInputElement;
    const area = app.container.querySelector("#t") as HTMLTextAreaElement;

    expect({
      inputAttribute: input.getAttribute("value"),
      areaAttribute: area.getAttribute("value"),
      // Both are still driven, because the PROPERTY is written either way.
      inputValue: input.value,
      areaValue: area.value,
    }).toEqual({
      inputAttribute: "written",
      areaAttribute: null,
      inputValue: "written",
      areaValue: "skipped",
    });
  });
});
