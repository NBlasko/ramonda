import { describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { Host, onDocument, onElement, onWindow, shouldUpdateOnPropsChange, state } from "../base/decorators";

/**
 * Three decorators are for components only, and each is refused twice: by the TYPE, and — for a
 * build that has no types — by a THROW naming what to do instead.
 *
 * The throw is not belt and braces. Two of these used to fail in the worst way available:
 * `@Host` on a hook wrote its metadata to a class no render path consults, so the tag was
 * silently ignored; `@onElement` reached a resolver that read `.enhancedNode` of `undefined` and
 * died with "Cannot read properties of undefined", an error naming nothing the author wrote.
 *
 * Everything else in the decorator set works on both — see DecoratorReach.test.tsx.
 */

describe("refused at runtime, with a message that says what to do", () => {
  test("@Host — a hook has no element", () => {
    expect(() => {
      // @ts-expect-error the type refuses it too; this checks the untyped build.
      @Host("section")
      class Styled extends Hook {}
      return Styled;
    }).toThrow(/@Host is for components, not hooks/);
  });

  test("@onElement — the listener has nothing to bind to", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    class Listening extends Hook {
      // @ts-expect-error the type refuses it too; this checks the untyped build.
      @onElement("click") onClick() {}
    }

    @Host("div")
    class Owner extends Component {
      h = this.use(Listening);
      render() {
        return <span>x</span>;
      }
    }

    await expect(getDOM<Owner>(<Owner />)).rejects.toThrow(/@onElement is for components, not hooks/);
    vi.restoreAllMocks();
  });

  test("@shouldUpdateOnPropsChange — a hook has no parent-driven prop update to gate", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    class Gated extends Hook {
      // @ts-expect-error the type refuses it too; this checks the untyped build.
      @shouldUpdateOnPropsChange
      gate() {
        return true;
      }
    }

    @Host("div")
    class Owner extends Component {
      h = this.use(Gated);
      render() {
        return <span>x</span>;
      }
    }

    await expect(getDOM<Owner>(<Owner />)).rejects.toThrow(/@shouldUpdateOnPropsChange is for components, not hooks/);
    vi.restoreAllMocks();
  });
});

describe("the neighbours that DO work on a hook", () => {
  test("@onWindow and @onDocument bind to targets a hook can reach", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fired: string[] = [];

    class Global extends Hook {
      @onWindow("resize") onResize() {
        fired.push("window");
      }
      @onDocument("click") onClick() {
        fired.push("document");
      }
    }

    @Host("div")
    class Owner extends Component {
      @state n = 0;
      h = this.use(Global);
      render() {
        return <span>{this.n}</span>;
      }
    }

    const app = await getDOM<Owner>(<Owner />);
    await app.settle();
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("click"));

    // This is the alternative the @onElement message points at, so it has to be true.
    expect(fired).toEqual(["window", "document"]);
    vi.restoreAllMocks();
  });
});
