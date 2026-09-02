import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { createContext } from "../base/Context";

/**
 * A component class with no name, and what a diagnostic says about it.
 *
 * `helpers/utils.ts` writes the case down: a class expression assigned to nothing has a
 * `constructor` whose `name` is the empty string. That is not a curiosity — a factory that returns
 * a class, or a test that builds one inline, produces exactly this, and every diagnostic that names
 * its component has to say something when there is nothing to say.
 *
 * `base/Context.ts` had it as `holder ?? "this component"`, and `??` does not catch `""`. Measured
 * before the fix, the RMD056 throw read:
 *
 *     [RMD056]  mounts ThemeProvider twice. A component publishes a context on ONE object, …
 *
 * — no subject, and a double space where the subject had been. `||` is what the question actually
 * asks: an empty name and an absent one want the same wording.
 *
 * This suite is about the WORDING, so it asserts on the message. The behaviour it reports on — two
 * publishers of one context on one component — is `TwoPublishersOnOneContext.test.tsx`.
 */
describe("a diagnostic about a component that has no name", () => {
  /**
   * Built through a factory so `name` is genuinely `""` — an inline `const X = class {}` infers it.
   *
   * The constraint is a CLASS rather than `typeof Component`: an anonymous subclass's constructor
   * takes `DefaultProps` concretely, while `typeof Component` is generic in its props, and the two
   * construct signatures are not assignable. What this needs from `T` is a `name` to assert on and
   * a tag JSX will accept, which is exactly what a class is.
   */
  function unnamed<T extends abstract new (...args: never[]) => unknown>(make: () => T): T {
    return make();
  }

  test("the RMD056 throw names the component when it can", async () => {
    const [Provider] = createContext({ theme: "dark" }, { label: "Theme" });

    class Named extends Component {
      first = this.use(Provider, () => ({ theme: "light" }));
      second = this.use(Provider, () => ({ theme: "light" }));
      render() {
        return <p>x</p>;
      }
    }

    await expect(getDOM(<Named />)).rejects.toThrow(/^\[RMD056\] Named mounts ThemeProvider twice\./);
  });

  test("and falls back to a phrase, not to a gap, when it cannot", async () => {
    const [Provider] = createContext({ theme: "dark" }, { label: "Theme" });

    const Anon = unnamed(
      () =>
        class extends Component {
          first = this.use(Provider, () => ({ theme: "light" }));
          second = this.use(Provider, () => ({ theme: "light" }));
          render() {
            return <p>x</p>;
          }
        },
    );
    expect(Anon.name).toBe("");

    let message = "";
    try {
      await getDOM((<Anon />) as never);
    } catch (thrown) {
      message = (thrown as Error).message;
    }

    expect(message).toContain("[RMD056] this component mounts ThemeProvider twice.");
    // The whole point: no run of two spaces anywhere a subject was meant to be.
    expect(message).not.toMatch(/ {2}/);
    // And the second half of the message, which names the subject again, is filled in too.
    expect(message).toContain("while this component can still read both");
  });

  test("a consumer with no provider renders its defaults, named or not", async () => {
    const [, Consumer] = createContext({ theme: "dark" }, { label: "Theme" });

    const Anon = unnamed(
      () =>
        class extends Component {
          ctx = this.use(Consumer);
          render() {
            return <p>{this.ctx.theme}</p>;
          }
        },
    );

    const { container } = await getDOM((<Anon />) as never);
    expect(container.textContent).toBe("dark");
  });
});
