import { describe, expect, test } from "vitest";
import { Component } from "../../base/Component";
import { createContext } from "../../base/Context";
import { getDOM } from "../../test/setup";

/**
 * RMD056 in a PRODUCTION build: the throw stays, the diagnostic goes.
 *
 * Two publishers of one context on one component is not a report that can wait for a DEV run to
 * find it. The second replaces the first for every descendant, while the component that made the
 * mistake can still read both — so the fault is invisible from the one place that could see it, and
 * the framework refuses instead of warning. That refusal is a `throw` outside `if (__DEV__)`, which
 * is why it is here and not in the dev suite.
 *
 * What production loses is the NAMES, both of them, and each for its own reason:
 *
 * - The COMPONENT. `holder` is the DEV-only twin of `runtime.owner`, kept apart precisely so the
 *   prod build strips it — so `holderName` answers `""` here for every component, named or not,
 *   and the message says "this component". That is the branch this file covers: the dev suite can
 *   only reach it through a class with no name (`AComponentWithNoName.test.tsx`), and here it is
 *   the only branch there is.
 * - The CONTEXT. `createContext`'s `label` renames the two hook classes under `if (__DEV__)`, so
 *   `{ label: "Theme" }` reads `ThemeProvider` in a dev message and plain `Provider` here.
 *
 * So the prod message is the shape below and nothing sharper is available to it. Both losses are
 * deliberate, and the throw is still worth making: it names the mechanism and the way out, which is
 * what a developer reading a production stack needs, and the component is at the top of that stack
 * anyway.
 */
describe("a context published twice, in a production build", () => {
  test("still throws, and says which component without being able to name it", async () => {
    const [Provider] = createContext({ theme: "dark" }, { label: "Theme" });

    class Panel extends Component {
      first = this.use(Provider, () => ({ theme: "light" }));
      second = this.use(Provider, () => ({ theme: "light" }));
      render() {
        return <p>x</p>;
      }
    }

    let message = "";
    try {
      await getDOM(<Panel />);
    } catch (thrown) {
      message = (thrown as Error).message;
    }

    expect(message).toContain("[RMD056] this component mounts Provider twice.");
    // Neither name survives, and both are asserted so a change to either is caught here rather
    // than showing up as a message nobody reads.
    expect(message).not.toContain("ThemeProvider");
    expect(message).not.toContain("Panel");
    expect(message).not.toMatch(/ {2}/);
  });

  test("and one Provider on its own is silent, as in development", async () => {
    const [Provider, Consumer] = createContext({ theme: "dark" }, { label: "Theme" });

    class Leaf extends Component {
      ctx = this.use(Consumer);
      render() {
        return <p>{this.ctx.theme}</p>;
      }
    }

    class Panel extends Component {
      only = this.use(Provider, () => ({ theme: "light" }));
      render() {
        return <Leaf />;
      }
    }

    const { container } = await getDOM(<Panel />);
    expect(container.textContent).toBe("light");
  });
});
