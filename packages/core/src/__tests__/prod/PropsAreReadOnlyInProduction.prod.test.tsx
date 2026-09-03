import { describe, expect, test } from "vitest";
import { Component } from "../../base/Component";
import { state } from "../../base/decorators";
import { getDOM } from "../../test/setup";

/**
 * A write to `props` throws in a PRODUCTION build too, which is a promise the source states and
 * nothing checked.
 *
 * `base/Component.ts` puts the throw OUTSIDE `if (__DEV__)` on purpose, and says why in its own
 * comment: the diagnostic beside it only explains the mistake, while the refusal is enforcement —
 * "behaviour cannot differ between builds". The alternative it rejects is worse than it sounds. A
 * silent drop in production means the value reads back as the old one, and the component runs on a
 * value nobody set, in the build where nobody is watching the console.
 *
 * The union of both coverage runs is what sent me here: the `if (__DEV__)` in front of
 * `reportPropWrite` had an unhit false side, so this file is the whole of the production half of
 * `RMD004`. It asserts the CODE too — the message carries `[RMD004]` so a person who hits it in a
 * released build has something to search for, and that is the part a diagnostic-free build could
 * quietly lose.
 *
 * **Run this suite the way its script does — `NODE_ENV=production`.** Without it `__DEV__` is TRUE
 * even under this config, and every assertion here measures the development build while reading as
 * a production one. Cost me a plant: moving the throw inside `if (__DEV__)` left these two tests
 * GREEN until the variable was set, which is a test that cannot fail dressed as one that can. The
 * `test:prod` script sets it; a bare `vitest run --config vitest.prod.config.ts` does not.
 */
describe("props in a production build", () => {
  test("a write still throws, and the message still names the code and the component", async () => {
    class Panel extends Component<{ label?: string }> {
      @state clicked = false;
      wrong() {
        // @ts-expect-error assigning to props is what this test is about
        this.props.label = "changed";
      }
      render() {
        return <p>{this.props.label ?? "none"}</p>;
      }
    }

    const app = await getDOM<Panel>(<Panel label="first" />);

    expect(() => app.instance.wrong()).toThrow(TypeError);
    expect(() => app.instance.wrong()).toThrow(/^\[RMD004\] Cannot assign to `props\.label` in <Panel \/>/);
    // And the value the parent set is what the component still reads: the write did not half-happen.
    expect(app.container.textContent).toBe("first");
    app.unmount();
  });

  /**
   * The same for a write that never reaches a render, because the refusal is in the PROXY rather
   * than anywhere a render can reach — a write from a handler, an interval, a promise resolving
   * after the page settled, all take this path.
   */
  test("a write from outside a render is refused the same way", async () => {
    class Panel extends Component<{ n?: number }> {
      render() {
        return <p>{String(this.props.n ?? 0)}</p>;
      }
    }

    const app = await getDOM<Panel>(<Panel n={1} />);
    await app.settle();

    expect(() => {
      // @ts-expect-error the point of the test
      app.instance.props.n = 2;
    }).toThrow(/\[RMD004\]/);
    expect(app.container.textContent).toBe("1");
    app.unmount();
  });
});
