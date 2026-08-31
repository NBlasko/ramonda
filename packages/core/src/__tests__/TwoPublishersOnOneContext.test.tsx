import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../base/Component";
import { Head } from "../base/Head";
import { createContext } from "../base/Context";

/**
 * The context object has more than one publisher, and `Head` is the second.
 *
 * `createContext` writes a per-key signal channel onto the owner's context object; the `Head` hook
 * writes the node its descendants should hang under. Same object, same mechanism, different keys —
 * and `types/commonTypes.ts` states the protocol that makes it safe: each publisher takes a key
 * nothing outside it can name (`createContext` a fresh number, `Head` a module-private symbol), and
 * whoever reads a key is whoever published it.
 *
 * Nothing ENFORCED any of that. The protocol is written down and both sides obey it, but a change to
 * how the context object is built would break `Head` silently — it does not go through
 * `createContext` and no test put the two of them on one component. That is what this file is: the
 * two invariants `Head` depends on without saying so.
 *
 * It is a test rather than a shared helper on purpose. The four accesses are two reads and two
 * writes of `object[key]`; wrapping them would add an indirection over the thing the type's own doc
 * says is the design — "the read is where the shape is named" — and would still not fail if the
 * object stopped being prototype-chained. A test does.
 */
describe("two publishers on one context object", () => {
  const [ToneProvider, ToneConsumer] = createContext({ tone: "plain" });

  /**
   * A Provider and a `Head` declared on the SAME component, with a consumer and a second `Head`
   * below.
   *
   * Both publishers write to that component's own context object in `@created`, and both readers
   * find what they are looking for: the consumer resolves the channel, and the deeper `Head` resolves
   * the node above it as its parent — which is what makes its tags nest rather than replace.
   */
  test("a Provider and a Head on one component, both found from below", async () => {
    class Leaf extends Component {
      tone = this.use(ToneConsumer);
      head = this.use(Head, () => ({ meta: [{ name: "leaf", content: "under-layout" }] }));
      render() {
        return <i id="leaf">{this.tone.tone}</i>;
      }
    }

    class Layout extends Component {
      @state tone = "warm";
      provided = this.use(ToneProvider, (self: Layout) => ({ tone: self.tone }));
      head = this.use(Head, () => ({ title: "Layout" }));
      render() {
        return (
          <div id="layout">
            <Leaf />
          </div>
        );
      }
    }

    const { container, instance, settle } = await getDOM<Layout>(<Layout />);
    const meta = (name: string) => document.head.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? null;

    // Head's key and the context's key on one object, neither standing on the other.
    expect(document.title).toBe("Layout");
    expect(meta("leaf")).toBe("under-layout");
    expect(container.querySelector("#leaf")!.textContent).toBe("warm");

    // And the channel is live, not a value read once at construction.
    instance.tone = "cold";
    await settle();
    expect(container.querySelector("#leaf")!.textContent).toBe("cold");
    expect(document.title).toBe("Layout");
  });

  /**
   * A published slot is an OWN property, which is the whole reason the tree comes out right.
   *
   * `Head` writes its node onto its OWN object so descendants inherit it through the prototype
   * chain. A sibling reads the same ANCESTOR object, so it must not see it — otherwise the second
   * branch hangs under the first, and one page's tags become another's children.
   *
   * That nesting is invisible while everything is mounted, which is why the assertion is about a
   * TEARDOWN. Dropping the first branch takes its own subtree's tags with it — `deep`, which really
   * is below it — and must leave its sibling's alone. Written the weak way, asserting only that all
   * three tags exist, this passed with `Head` publishing onto the parent's object instead of its own.
   */
  test("dropping a branch takes its descendants' tags and leaves its sibling's", async () => {
    class Deep extends Component {
      head = this.use(Head, () => ({ meta: [{ name: "deep", content: "under-a" }] }));
      render() {
        return <u id="deep">deep</u>;
      }
    }

    class BranchA extends Component {
      head = this.use(Head, () => ({ meta: [{ name: "branch-a", content: "a" }] }));
      render() {
        return (
          <b className="branch">
            <Deep />
          </b>
        );
      }
    }

    class BranchB extends Component {
      head = this.use(Head, () => ({ meta: [{ name: "branch-b", content: "b" }] }));
      render() {
        return <b className="branch">b</b>;
      }
    }

    class Page extends Component {
      @state showA = true;
      head = this.use(Head, () => ({ title: "Root" }));
      render() {
        return (
          <div id="page">
            {this.showA ? <BranchA /> : null}
            <BranchB />
          </div>
        );
      }
    }

    const { instance, settle } = await getDOM<Page>(<Page />);
    const has = (name: string) => document.head.querySelector(`meta[name="${name}"]`) !== null;

    expect(document.title).toBe("Root");
    expect([has("branch-a"), has("deep"), has("branch-b")]).toEqual([true, true, true]);

    instance.showA = false;
    await settle();

    // `deep` was below A and goes with it. `branch-b` was beside A and stays — which it only does if
    // A published on its own object rather than on the one B also reads.
    expect([has("branch-a"), has("deep"), has("branch-b")]).toEqual([false, false, true]);
    expect(document.title).toBe("Root");
  });
});
