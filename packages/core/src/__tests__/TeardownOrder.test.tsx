import { describe, test, expect, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { state, destroyed } from "../base/decorators";
import { Component } from "../base/Component";
import { componentsIn } from "../core/DiffAndMerge";

/**
 * `@destroyed` runs from the inside out: a child's before its parent's.
 *
 * That is the order the DOM walk gave when a component was an element and its children sat under it,
 * and it is the only order a teardown can be written against — a parent closes the socket, cancels
 * the controller, clears the store its children are still unsubscribing from. Reversed, a child's
 * `@destroyed` touches a resource its parent has already released.
 *
 * The record is what carries the order now, and a record entry is not always a region: an ordinary
 * element between two components is a plain node in it, holding a record of its own.
 */

let order: string[] = [];

beforeEach(() => {
  order = [];
});

describe("teardown order", () => {
  test("a component under a plain element is destroyed before the component above it", async () => {
    class Leaf extends Component {
      @destroyed
      gone(): void {
        order.push("leaf");
      }
      render() {
        return <b>leaf</b>;
      }
    }

    class Middle extends Component {
      @destroyed
      gone(): void {
        order.push("middle");
      }
      // The element between them is the point: `Leaf`'s region hangs off the <div>'s own record, not
      // off `Middle`'s entries.
      render() {
        return (
          <div className="wrap">
            <Leaf />
          </div>
        );
      }
    }

    class App extends Component {
      @state show = true;
      render() {
        return <section id="root">{this.show ? <Middle /> : null}</section>;
      }
    }

    const { container, settle } = await getDOM(<App />);
    const app = componentsIn(container).find((c) => c.constructor.name === "App") as unknown as {
      show: boolean;
    };

    expect(container.querySelector("b")).not.toBeNull();

    app.show = false;
    await settle();

    expect(container.querySelector("#root")!.innerHTML).toBe("");
    expect(order).toEqual(["leaf", "middle"]);
  });

  test("an element that holds no record of its own is still walked through", async () => {
    class Deep extends Component {
      @destroyed
      gone(): void {
        order.push("deep");
      }
      render() {
        return <i>deep</i>;
      }
    }

    class Holder extends Component {
      @destroyed
      gone(): void {
        order.push("holder");
      }
      // Two elements deep. The outer <div> has no region among its own children, so it keeps no
      // record at all — the walk has to go through the DOM to find the inner one's.
      render() {
        return (
          <div className="outer">
            <span className="inner">
              <Deep />
            </span>
          </div>
        );
      }
    }

    class App extends Component {
      @state show = true;
      render() {
        return <section id="root">{this.show ? <Holder /> : null}</section>;
      }
    }

    const { container, settle } = await getDOM(<App />);
    const app = componentsIn(container).find((c) => c.constructor.name === "App") as unknown as {
      show: boolean;
    };

    app.show = false;
    await settle();

    expect(order).toEqual(["deep", "holder"]);
  });
});
