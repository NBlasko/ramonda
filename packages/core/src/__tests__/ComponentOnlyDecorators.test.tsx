import { describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { onDocument, onWindow, ShouldUpdateOnPropsChange, state } from "../base/decorators";

/**
 * Three decorators are for components only, and each is refused twice: by the TYPE, and — for a
 * build that has no types — by a THROW naming what to do instead.
 *
 * The throw is not belt and braces. Two of these used to fail in the worst way available:
 * silently ignored; a listener decorator reached a resolver that read a property of `undefined` and
 * died with "Cannot read properties of undefined", an error naming nothing the author wrote.
 *
 * Everything else in the decorator set works on both — see DecoratorReach.test.tsx.
 */

describe("refused at runtime, with a message that says what to do", () => {
  test("@ShouldUpdateOnPropsChange — a hook has no parent-driven prop update to gate", () => {
    // A class decorator, so this lands when the class is DEFINED rather than when
    // something first renders it.
    expect(() => {
      // @ts-expect-error the type refuses it too; this checks the untyped build.
      @ShouldUpdateOnPropsChange(() => true)
      class Gated extends Hook {
        gate() {
          return true;
        }
      }
      return Gated;
    }).toThrow(/@ShouldUpdateOnPropsChange is for components, not hooks/);
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

    class Owner extends Component {
      @state n = 0;
      h = this.use(Global);
      render() {
        return (
          <div>
            <span>{this.n}</span>
          </div>
        );
      }
    }

    const app = await getDOM<Owner>(<Owner />);
    await app.settle();
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("click"));

    // This is the alternative those messages point at, so it has to be true.
    expect(fired).toEqual(["window", "document"]);
    vi.restoreAllMocks();
  });
});
