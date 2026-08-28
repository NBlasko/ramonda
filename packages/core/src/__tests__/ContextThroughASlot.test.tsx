import { describe, test, expect } from "vitest";
import { Component } from "../index";
import { state } from "../base/decorators";
import { createContext } from "../base/Context";
import { getDOM } from "../test/setup";
import type { RamondaNode } from "../types/vdom";

/**
 * Context read from a slot that is rendered somewhere other than where it was written.
 *
 * Two rules meet here that had never met in a test. A slot **belongs where it LANDS, not where it
 * was written** — that is what decides its lifecycle order and its depth, and it is measured in
 * `SlotLifecycleOrder`. Context, meanwhile, is looked UP the component tree. Put together they
 * settle a question neither answers alone: a `<Reader />` written inside one provider and handed to
 * a component that provides something else reads **the one it lands under**.
 *
 * The third case below looks at first like a contradiction — a slot that reads the WRITER's
 * provider — and is the same rule. The lookup climbs from where the slot landed, and the writer is
 * on that path whenever it is also the one that rendered the landing component. What decides the
 * answer is always the nearest provider ABOVE the landing position; sometimes that happens to be
 * the writer, and nothing about where the JSX was typed changes it.
 */
const [ThemeProvider, ThemeConsumer] = createContext({ label: "none" });

/** Reads the context wherever it ends up, and shows what it found. */
class Reader extends Component {
  theme = this.use(ThemeConsumer);
  render() {
    return <span className="read">{this.theme.label}</span>;
  }
}

/** Provides `inner`, and renders whatever slot it is handed INSIDE its own provider. */
class Inner extends Component<{ slot?: RamondaNode }> {
  provider = this.use(ThemeProvider, () => ({ label: "inner" }));
  render() {
    return <div className="inner">{this.props.slot}</div>;
  }
}

/** Provides nothing, so a slot landing here has to keep looking upwards. */
class Bare extends Component<{ slot?: RamondaNode }> {
  render() {
    return <div className="bare">{this.props.slot}</div>;
  }
}

const read = (root: Element) => [...root.querySelectorAll(".read")].map((node) => node.textContent);

describe("a slot reads the context it LANDS under", () => {
  test("written under one provider and rendered under another", async () => {
    class Outer extends Component {
      provider = this.use(ThemeProvider, () => ({ label: "outer" }));
      render() {
        return <Inner slot={<Reader />} />;
      }
    }

    const app = await getDOM<Outer>(<Outer />);
    await app.settle();
    expect(read(app.container)).toEqual(["inner"]);
  });

  test("written where there is no provider at all", async () => {
    class NoneAbove extends Component {
      render() {
        return <Inner slot={<Reader />} />;
      }
    }

    const app = await getDOM<NoneAbove>(<NoneAbove />);
    await app.settle();
    expect(read(app.container)).toEqual(["inner"]);
  });

  /**
   * The case that looks like the opposite answer and is the same one.
   *
   * `Bare` provides nothing, so the lookup keeps climbing and reaches `Writer` — which is above the
   * landing position, because it is what rendered `Bare`. The slot is not reading where it was
   * typed; it is reading the nearest provider above where it went, and here they coincide.
   */
  test("the landing place provides nothing, so the search keeps climbing", async () => {
    class Writer extends Component {
      provider = this.use(ThemeProvider, () => ({ label: "writer" }));
      render() {
        return <Bare slot={<Reader />} />;
      }
    }

    const app = await getDOM<Writer>(<Writer />);
    await app.settle();
    expect(read(app.container)).toEqual(["writer"]);
  });

  /**
   * Nothing above the landing position at all, so the context's own default answers. The point is
   * that a displaced slot does NOT fall back to what was above the place it was written — there is
   * a provider in this tree and it is deliberately not on the path.
   */
  test("nothing above where it lands, so the default answers", async () => {
    class Sibling extends Component {
      provider = this.use(ThemeProvider, () => ({ label: "not on the path" }));
      render() {
        return <span />;
      }
    }
    class Split extends Component {
      render() {
        return (
          <div>
            <Sibling />
            <Bare slot={<Reader />} />
          </div>
        );
      }
    }

    const app = await getDOM<Split>(<Split />);
    await app.settle();
    expect(read(app.container)).toEqual(["none"]);
  });

  /**
   * And the subscription survives the displacement, which is the half that a wiring mistake would
   * break silently: a displaced reader would show the first value for ever and look correct on the
   * page anybody screenshotted.
   *
   * Both readers are asserted together — one displaced through two layers, one written where it is
   * rendered — so a change that reaches only the ordinary one cannot pass.
   */
  test("a displaced reader follows the provider it found", async () => {
    class Middle extends Component<{ slot?: RamondaNode }> {
      render() {
        return <Bare slot={this.props.slot} />;
      }
    }
    class Deep extends Component {
      @state tone = "first";
      provider = this.use(ThemeProvider, () => ({ label: this.tone }));
      render() {
        return (
          <div>
            <Middle slot={<Reader />} />
            <Reader />
          </div>
        );
      }
    }

    const app = await getDOM<Deep>(<Deep />);
    await app.settle();
    expect(read(app.container)).toEqual(["first", "first"]);

    app.instance.tone = "second";
    await app.settle();
    expect(read(app.container)).toEqual(["second", "second"]);
  });
});
