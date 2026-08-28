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

describe("a media element's playback state", () => {
  /**
   * `volume` looks exactly like `width`, which IS an attribute, and is not one. Written as an
   * attribute it did nothing at all: the word sat in the markup and the element played at full
   * volume.
   *
   * `playbackRate` and `currentTime` are the same, and are in the table for the same reason — not
   * because anybody would reach for them in JSX (a seek is an action, and actions go through a ref)
   * but because the cost of an entry is a row and the cost of leaving one out is a silent no-op.
   */
  test("volume reaches the element and writes no attribute", async () => {
    class Quiet extends Component {
      @state level = 0.25;
      render() {
        return <video id="v" volume={this.level} />;
      }
    }

    const app = await getDOM<Quiet>(<Quiet />);
    await app.settle();
    const video = app.container.querySelector("#v") as HTMLVideoElement;
    expect({ property: video.volume, attribute: video.getAttribute("volume") }).toEqual({
      property: 0.25,
      attribute: null,
    });

    app.instance.level = 1;
    await app.settle();
    expect(video.volume).toBe(1);
  });

  /**
   * `muted` is NOT in that table, and the difference is the point: it has a real content attribute,
   * which is what carries the default muted state into a served page. So it is written as well as
   * set, and both halves are asserted above.
   */
  /**
   * The spelling, which is the whole reason the table is matched as written.
   *
   * These names have no HTML form to follow — there is no `playbackrate` content attribute for
   * `playbackRate` to be the lower-case OF — so the property name is the only name there is. Folding
   * the case before the lookup made `playbackrate={2}` match the table and then write nothing at
   * all, because `"playbackrate" in video` is false: a silent no-op, and it was the spelling the
   * types encourage.
   */
  test("playbackRate is written as the property, and reaches it", async () => {
    class Fast extends Component {
      @state rate = 2;
      render() {
        return <video id="v" playbackRate={this.rate} currentTime={5} />;
      }
    }

    const app = await getDOM<Fast>(<Fast />);
    await app.settle();
    const video = app.container.querySelector("#v") as HTMLVideoElement;
    expect({
      rate: video.playbackRate,
      time: video.currentTime,
      attributes: video.getAttributeNames().sort().join(","),
    }).toEqual({ rate: 2, time: 5, attributes: "id" });

    app.instance.rate = 0.5;
    await app.settle();
    expect(video.playbackRate).toBe(0.5);
  });

  /**
   * And the misspelling, which is what folding the case hid.
   *
   * `playbackrate` is not a name at all — no attribute, no property. Matched against a folded table
   * it looked like one, and the write that followed did nothing, because `"playbackrate" in video`
   * is false. The author saw no property set, no attribute written, and no complaint.
   *
   * Now it falls through as any unrecognised name does, and the word it leaves in the markup is the
   * evidence — which is also what `@ramonda/check` reports at the line that wrote it. A mistake that
   * shows is better than one the framework quietly absorbs.
   */
  test("a misspelled property name is left visible rather than silently swallowed", async () => {
    class Typo extends Component {
      render() {
        const misspelled: Record<string, unknown> = { playbackrate: 2 };
        return <video id="v" {...misspelled} />;
      }
    }

    const app = await getDOM<Typo>(<Typo />);
    await app.settle();
    const video = app.container.querySelector("#v") as HTMLVideoElement;
    expect({ attribute: video.getAttribute("playbackrate"), rate: video.playbackRate }).toEqual({
      attribute: "2",
      rate: 1,
    });
  });

  test("muted is not treated as property-only, because it has an attribute", async () => {
    const app = await getDOM<Media>(<Media />);
    await app.settle();
    const video = app.container.querySelector("#v") as HTMLVideoElement;
    expect(video.getAttribute("muted")).toBe("");
  });
});

describe("an attribute HTML does not have is not written", () => {
  /**
   * One rule with a table behind it, rather than a branch per tag. The contrast is on ONE element,
   * because that is what makes the table necessary: `width` and `volume` are written side by side in
   * the same JSX, and only one of them is an attribute.
   */
  test("two names on one element, and only the real attribute is written", async () => {
    class Player extends Component {
      render() {
        return <video id="v" width={320} volume={0.5} />;
      }
    }

    const app = await getDOM<Player>(<Player />);
    await app.settle();
    const video = app.container.querySelector("#v") as HTMLVideoElement;

    expect({
      width: video.getAttribute("width"),
      volume: video.getAttribute("volume"),
      // Both reached the element; only one of them had anywhere in the markup to go.
      widthProperty: video.width,
      volumeProperty: video.volume,
    }).toEqual({ width: "320", volume: null, widthProperty: 320, volumeProperty: 0.5 });
  });
});
