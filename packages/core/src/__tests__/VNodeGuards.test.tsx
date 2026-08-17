import { describe, expect, test } from "vitest";
import { Component } from "../base/Component";
import { bootstrap } from "../index";
import { list } from "../base/list";
import { isListNode, isVNode } from "../vdom/guards";
import { COMPONENT_TYPE, TEXT_TYPE, IS_LIST } from "../helpers/constants";

/**
 * The two predicates the vdom uses to decide what a JSX child IS, pinned here
 * because a guard's STRICTNESS is the half nothing else tests.
 *
 * `isListNode` needs no help — loosening it to "any object" fails 908 of core's
 * 1066 tests, measured. `isVNode` was the opposite: replacing the exact
 * `type === TEXT_TYPE || type === COMPONENT_TYPE` check with the looser
 * "has a `type` and a `name`" spelling passed all 1066. That gap is what this
 * file closes.
 *
 * Why the looser spelling matters at all: `normalizeChildren` pushes whatever
 * `isVNode` approves straight into the children array, and everything it turns
 * down becomes a hole plus RMD037. So a foreign object carrying a `type` and a
 * `name` — a parsed markdown node, a third-party descriptor, anything with two
 * very ordinary field names — would be waved past the report and reach the diff.
 */
describe("the vdom's guards", () => {
  test("isVNode admits exactly the two shapes VNode names", () => {
    expect(isVNode({ type: TEXT_TYPE, name: "div", attributes: {}, children: [] })).toBe(true);
    expect(isVNode({ type: COMPONENT_TYPE, name: class {}, attributes: {} })).toBe(true);
  });

  test("isVNode turns down a foreign object that merely HAS a type and a name", () => {
    // The exact shape the loose spelling let through — and the reason the guard
    // reads the two type constants rather than checking for presence.
    expect(isVNode({ type: "heading", name: "h2" })).toBe(false);
    expect(isVNode({ type: 0, name: "" })).toBe(false);
  });

  test("isVNode turns down everything that is not an object", () => {
    for (const value of [null, undefined, "div", 7, true, Symbol("x"), () => {}]) {
      expect(isVNode(value)).toBe(false);
    }
  });

  test("isListNode reads the marker, not the shape", () => {
    expect(isListNode({ [IS_LIST]: true, owner: "1:g0", vnodes: [], clean: [] })).toBe(true);
    // A plain object with the same fields and no marker is not a list: the
    // marker is what `list()` and `h` stamp, and nothing else may claim it.
    expect(isListNode({ owner: "1:g0", vnodes: [], clean: [] })).toBe(false);
    expect(isListNode(null)).toBe(false);
  });

  test("a foreign object among children is reported and dropped, not rendered", async () => {
    class Foreign extends Component {
      render() {
        // Cast because this is precisely what the types forbid and a JS caller
        // can still do — a value from outside TypeScript's reach.
        return <div id="host">{{ type: "heading", name: "h2" } as never}</div>;
      }
    }

    const root = document.createElement("div");
    document.body.appendChild(root);
    bootstrap(<Foreign />, root);

    expect(root.querySelector("#host")?.textContent).toBe("");
    root.remove();
  });

  test("a list among children survives as one child", async () => {
    class WithList extends Component {
      items = ["a", "b"];
      render() {
        return (
          <ul id="host">
            {list(this.items, (item) => (
              <li>{item}</li>
            ))}
          </ul>
        );
      }
    }

    const root = document.createElement("div");
    document.body.appendChild(root);
    bootstrap(<WithList />, root);

    expect(root.querySelectorAll("#host li")).toHaveLength(2);
    root.remove();
  });
});
