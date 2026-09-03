import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { getDOM, unnamed } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { createContext } from "../base/Context";
import { list } from "../base/list";
import { displayName } from "../helpers/utils";
import { resetDiagnostics } from "../debug/diagnostics";

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
 *
 * ## The rest of the family, found by coverage and measured 2026-09-02
 *
 * Three of core's four thinnest files by merged branch coverage had the same unhit branch: the side
 * where the name is empty. `helpers/utils.ts`'s `displayName` answered `""` there — its own note
 * said `??` could not become `||` "without changing "" into Unknown", and never asked whether any
 * caller wanted `""`. None did. Every one interpolates it or puts it in a dedup key.
 *
 * Two different absences were being conflated in two opposite directions, and both are pinned below:
 *
 * - a caller writing `<${name} />` printed `< />` — a subject that reads as a syntax error;
 * - a caller distinguishing "no component at all" from "a component" gave the nameless one the word
 *   for NO component: `outside a render`, `root`, `A render`. Those say the markup belongs to
 *   nobody, about a component that is right there.
 *
 * **What cannot be reached this way, so nobody probes for it twice:** a class expression with a
 * DECORATED member is named by the transpiler — esbuild lowers the class into a temporary to apply
 * the decorator and the temporary's name (`_b`) becomes the class's. So `RMD059`, `RMD038` and
 * `RMD047`, which each need a member decorator to fire, never see an empty name. Only the
 * decorator-free paths do, which is why the cases below are the ones they are.
 */
describe("a diagnostic about a component that has no name", () => {
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

  /**
   * The helper itself, because eight call sites read it and none of them checked.
   *
   * Both halves of its fallback are real and both now answer the same word: an instance with no
   * `constructor` at all, and an instance of a class whose `name` is `""`.
   */
  test("displayName answers a word for an empty name, not the empty string", () => {
    const Anon = unnamed(() => class {});
    expect(Anon.name).toBe("");
    expect(displayName(new (Anon as new () => object)())).toBe("Unknown");
    expect(displayName(Object.create(null))).toBe("Unknown");
    expect(displayName(undefined)).toBe("Unknown");
    class Named {}
    expect(displayName(new Named())).toBe("Named");
  });

  /**
   * The two THROWN messages a nameless class can actually reach, and why they are the only two.
   *
   * Twenty-nine sites read `constructor.name` bare and put it in a message; all of them now go
   * through `displayName`, and `scripts/check-nameless-class.mjs` refuses a new one. Most cannot be
   * pinned from a test at all, and the reason is written into `test/setup.ts`'s `unnamed()`: a class
   * expression with a DECORATED member is named by the transpiler. `RMD001`, `RMD006`, `RMD008`,
   * `RMD009` and the hydration family all need `@state`, `@created` or `@deferHydration` to fire, so
   * the class that reaches them always has a name.
   *
   * These two need no decorator, which is what makes them reachable — and they are the two that
   * THROW, so a reader meets them with nothing else on the page to explain what happened.
   */
  test("the RMD004 throw names a nameless component", async () => {
    const Anon = unnamed(
      () =>
        class extends Component<{ label?: string }> {
          wrong() {
            (this.props as { label?: string }).label = "changed";
          }
          render() {
            return <p>{this.props.label ?? "none"}</p>;
          }
        },
    );
    expect(Anon.name).toBe("");

    const app = await getDOM((<Anon />) as never);
    const instance = app.instance as unknown as { wrong(): void };

    expect(() => instance.wrong()).toThrow(/\[RMD004\] Cannot assign to `props\.label` in <Unknown \/>/);
    app.unmount();
  });

  test("the RMD015 throw names a nameless hook", async () => {
    const Store = unnamed(() => class extends Hook<{ n: number }> {});
    expect(Store.name).toBe("");

    class Holder extends Component {
      store = this.use(Store as never, () => ({ n: 1 }));
      render() {
        return <p>x</p>;
      }
    }

    const app = await getDOM<Holder>(<Holder />);
    const store = app.instance.store as unknown as { props: { n: number } };

    expect(() => {
      store.props.n = 2;
    }).toThrow(/\[RMD015\] Cannot assign to `props\.n` in <Unknown \/>/);
    app.unmount();
  });

  /**
   * The other half of the family, and the one that got past the gate.
   *
   * `scripts/check-nameless-class.mjs` greps for `constructor.name`, so it never saw the messages
   * that hold the CLASS itself — `${hook.name}`, `${ctor.name}`, `${vnode.name.name}`. Seven of
   * those existed while the commit that added the gate said the family was closed. They read
   * `className()` now, and this is the one a user meets: RMD055 THROWS, so it arrives with nothing
   * else on the page to explain it.
   *
   * The gate cannot cheaply cover this half, and the helper's own note says why: `${x.name}` is
   * indistinguishable from an ordinary data read.
   */
  test("the RMD055 throw names a nameless hook class", async () => {
    const Store = unnamed(() => class extends Hook<{ n: number }> {});
    expect(Store.name).toBe("");

    class Holder extends Component {
      // An object literal instead of a callback, which is the fault RMD055 refuses.
      store = this.use(Store as never, { n: 1 } as never);
      render() {
        return <p>x</p>;
      }
    }

    await expect(getDOM(<Holder />)).rejects.toThrow(/\[RMD055\] <Unknown \/> was given a plain object/);
  });

  describe("a diagnostic raised while a nameless component renders", () => {
    let records: RamondaDiagnostic[] = [];

    beforeEach(() => {
      records = [];
      resetDiagnostics();
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
    });

    afterEach(() => {
      globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
      vi.restoreAllMocks();
    });

    const of = (code: string) => records.find((record) => record.code === code);

    /**
     * The one in this family a nameless class can actually reach, and the one that was measured
     * wrong: `< />'s \`render()\` is async`.
     */
    test("RMD060 names a subject rather than printing an empty tag", async () => {
      const Anon = unnamed(
        () =>
          class extends Component {
            // @ts-expect-error an async render is the fault under test
            async render() {
              return <p>x</p>;
            }
          },
      );
      expect(Anon.name).toBe("");

      try {
        await getDOM((<Anon />) as never);
      } catch {
        // The message is the subject here, not whether the mount survives it.
      }

      expect(of("RMD060")?.message).toContain("<Unknown />");
      expect(of("RMD060")?.message).not.toContain("< />");
    });

    /**
     * `renderingOwner`'s three states. `outside a render` is a GROUP for markup no component owns —
     * a module-level vnode — so handing it to a component that is mid-render says the opposite of
     * what is true, and merges every nameless component's reports into that group's dedup key.
     */
    test("RMD039 does not call a rendering component `outside a render`", async () => {
      const Anon = unnamed(
        () =>
          class extends Component {
            render() {
              return <p class="lead">text</p>;
            }
          },
      );

      await getDOM((<Anon />) as never);

      expect(of("RMD039")?.data?.owner).toBe("Unknown");
      expect(of("RMD039")?.data?.owner).not.toBe("outside a render");
    });

    /**
     * The TAG in the same message, which is a DIFFERENT fallback — `vdom/CreateRamonda.ts` — and
     * only reached when a COMPONENT is the one given `class`. A host element brings its own tag, so
     * the test above cannot see this one; measured, and the reason it is a second test.
     *
     * The report is `\`class\` was given on <tag>, from owner`, so an empty tag reads `<>`.
     */
    test("RMD039 names the nameless component it was given `class` on", async () => {
      const Anon = unnamed(
        () =>
          class extends Component {
            render() {
              return <p>text</p>;
            }
          },
      );
      class Holder extends Component {
        render() {
          // `class` on a component is the fault under test, so it is not in the props type — which
          // is the diagnostic's whole point. Widened here rather than declared, so the component
          // under test stays the shape a reader would write.
          const Loose = Anon as unknown as typeof Component<Record<string, unknown>>;
          return <Loose class="lead" />;
        }
      }

      await getDOM(<Holder />);

      expect(of("RMD039")?.data?.tag).toBe("a component");
      expect(of("RMD039")?.message).not.toContain("<>");
    });

    /** The same shape in `jsxRules`, whose no-component word is `A render`. */
    test("RMD023 does not call a rendering component `A render`", async () => {
      const Anon = unnamed(
        () =>
          class extends Component {
            render() {
              return <ul>{[<li>a</li>, <li>b</li>]}</ul>;
            }
          },
      );

      await getDOM((<Anon />) as never);

      expect(of("RMD023")?.message).toContain("<Unknown />");
      expect(of("RMD023")?.message).not.toContain("<A render />");
    });

    /**
     * RMD057's subject, which is `debug/contextPairing.ts`'s own fallback rather than this file's.
     *
     * It reads the name with a ternary, so the empty side was already correct — and unhit, which is
     * a promise with nothing behind it. The report has to say SOMETHING: a consumer declared above
     * the provider on the same component is a field-order mistake, and a message with no subject
     * cannot tell the reader which component to reorder.
     */
    test("RMD057 says `a component` when there is no name to print", async () => {
      const [Provider, Consumer] = createContext({ theme: "dark" }, { label: "Theme" });
      const Anon = unnamed(
        () =>
          class extends Component {
            // Declared BEFORE the provider, which is the fault: the consumer resolves its channel
            // when it is constructed, so it reads an ancestor's provider rather than this one's.
            read = this.use(Consumer);
            give = this.use(Provider, () => ({ theme: "light" }));
            render() {
              return <p>{this.read.theme}</p>;
            }
          },
      );

      await getDOM((<Anon />) as never);

      expect(of("RMD057")?.message).toContain("a component uses ThemeConsumer above ThemeProvider");
      expect(of("RMD057")?.message).not.toMatch(/ {2}/);
      expect(of("RMD057")?.message).not.toContain("<>");
    });

    /**
     * `listHostFor`'s label, which reaches a message as a bare word rather than a tag: "Two rows
     * rendered by ." was the sentence, and the dedup key was `:key` — so two nameless components
     * with the same duplicate key reported once between them.
     */
    test("RMD002 from a list names the component that rendered the rows", async () => {
      const Anon = unnamed(
        () =>
          class extends Component {
            render() {
              return (
                <ul>
                  {list([{ id: 1 }, { id: 2 }], () => (
                    <li key="same">row</li>
                  ))}
                </ul>
              );
            }
          },
      );

      await getDOM((<Anon />) as never);

      expect(of("RMD002")?.data?.owner).toBe("a list");
      // The subject reads as one: `rendered by list` was the first spelling, and this message
      // interpolates the name bare where a named owner needs no article.
      expect(of("RMD002")?.message).toContain("Two rows rendered by a list");
    });

    /** And in `lintChildren`, whose no-owner word is `the root` — in the message and in the key. */
    test("RMD002 does not call a nameless component the root", async () => {
      const Anon = unnamed(
        () =>
          class extends Component {
            render() {
              return (
                <ul>
                  <li key="same">a</li>
                  <li key="same">b</li>
                </ul>
              );
            }
          },
      );

      await getDOM((<Anon />) as never);

      expect(of("RMD002")?.message).toContain("<Unknown />");
      expect(of("RMD002")?.message).not.toContain("the root");
    });
  });
});
