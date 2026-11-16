import { describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { onDocument, onWindow, state } from "../base/decorators";

/**
 * The listener decorators work on a hook as well as a component.
 *
 * They used to fail in the worst way available on one: a listener decorator reached a resolver that
 * read a property of `undefined` and died with "Cannot read properties of undefined", an error naming
 * nothing the author wrote. `@catchError` is the one decorator left that is for components only, and
 * it is refused on a hook in `CatchErrorDecorator.test.tsx`. `@ShouldUpdateOnPropsChange` was the
 * other, and was removed: a predicate an app writes can stop a component rendering when it should.
 *
 * Everything else in the decorator set works on both — see DecoratorReach.test.tsx.
 */
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
