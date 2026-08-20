import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { catchError, compute, created, memoized, mounted, state } from "../base/decorators";
import { Component } from "../base/Component";
import type { RamondaNode } from "../types/vdom";

/**
 * `render` is the one member core reserves, and until this it was reserved only by TypeScript's
 * `abstract` — a build with no types refused nothing, and the two worst outcomes said nothing
 * either.
 *
 * Measured before the rule was written, one class per decorator:
 * - `@compute get render()` — `TypeError: component.render is not a function`, a raw throw out of
 *   the framework with no diagnostic.
 * - `@memoized render()` — no throw at all, and the component **never updates again**:
 *   `"0" -> "0"` after a state write that should have shown `1`.
 * - `@created`, `@catchError`, `@state` — mounted and rendered, quietly meaning something else.
 *
 * A class body is evaluated when the module is imported, so each case is built inside its own
 * arrow: the decorator has to run where the expectation can catch it.
 */
describe("render takes no decorator", () => {
  const refused = (build: () => unknown) => expect(build).toThrow(/`render` takes no decorator/);

  /**
   * The only one TypeScript refuses on its own — a getter cannot override a method — hence the
   * `@ts-expect-error`, which is also the point: the type system catches the shape that throws
   * LOUDLY and lets the one that freezes the page in silence straight through. This guard is the
   * half that covers a build with no types, and the half that covers the quiet failure.
   */
  test("the one that breaks rendering outright", () => {
    refused(() => {
      class Broken extends Component {
        // @ts-expect-error a getter cannot override the base class's method
        @compute get render(): RamondaNode {
          return <span>x</span>;
        }
      }
      return Broken;
    });
  });

  test("the one that froze the page in silence", () => {
    refused(() => {
      class Frozen extends Component {
        @memoized
        render(): RamondaNode {
          return <span>x</span>;
        }
      }
      return Frozen;
    });
  });

  test("a lifecycle decorator, which would run the render outside the render pass", () => {
    refused(() => {
      class Early extends Component {
        @created
        render(): RamondaNode {
          return <span>x</span>;
        }
      }
      return Early;
    });
    refused(() => {
      class Late extends Component {
        @mounted
        render(): RamondaNode {
          return <span>x</span>;
        }
      }
      return Late;
    });
  });

  test("the error handler, and state", () => {
    refused(() => {
      class Handling extends Component {
        @catchError
        render(): RamondaNode {
          return <span>x</span>;
        }
      }
      return Handling;
    });
    refused(() => {
      class Serialised extends Component {
        @state render = (): RamondaNode => <span>x</span>;
      }
      return Serialised;
    });
  });

  /**
   * The silence that matters as much: a member named anything else takes its decorator as before,
   * and so does an ordinary `render` with none.
   */
  test("everything else is untouched", async () => {
    class Ordinary extends Component {
      @state n = 0;
      @compute get label(): string {
        return `n is ${this.n}`;
      }
      render(): RamondaNode {
        return <span>{this.label}</span>;
      }
    }
    const mountedOrdinary = await getDOM<Ordinary>(<Ordinary />);
    expect(mountedOrdinary.container.textContent).toBe("n is 0");
    mountedOrdinary.instance.n = 1;
    await mountedOrdinary.settle();
    expect(mountedOrdinary.container.textContent).toBe("n is 1");
  });
});
