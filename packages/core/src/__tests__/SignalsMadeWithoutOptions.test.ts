import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { State } from "../reactivity/State";
import { attach, detach } from "../helpers/constants";

/**
 * The signals made for every component — one per prop it reads, one per `@state` — are made with their
 * listener already on, by `State.heardBy`, and not through `new State(value, { listener: { id,
 * onChange } })`, whose two objects the constructor reads and drops. Measured in Chrome, creating 1,000
 * rows of five components: the props proxy's `get` allocated 73 B per component, most of it those.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = ["base/Component.ts", "base/Hook.ts", "base/decorators.ts"];

/** Every `new State(…)` in a file given more than its value. */
function statesMadeWithOptions(file: string): string[] {
  const path = join(HERE, "..", file);
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  (function walk(node: ts.Node): void {
    if (ts.isNewExpression(node) && node.expression.getText() === "State" && (node.arguments?.length ?? 0) > 1) {
      found.push(`line ${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, walk);
  })(source);
  return found;
}

describe("signals made for every component", () => {
  test.each(FILES)("%s makes no State through an options object", (file) => {
    expect(statesMadeWithOptions(file)).toEqual([]);
  });

  test("State.heardBy calls its listener on a change, and is replaced by the same id", () => {
    let heard = 0;
    let replaced = 0;
    const state = State.heardBy(1, 7, () => heard++);
    state.set(2);
    expect(heard).toBe(1);
    state[attach]({ id: 7, onChange: () => replaced++ });
    state.set(3);
    expect([heard, replaced]).toEqual([1, 1]);
    expect(state.get()).toBe(3);
  });

  /**
   * The path production takes: a component's signal is heard by its RUNTIME, an object whose `reBuild` it
   * calls with that object as `this`. A second listener — a list row, a context consumer — moves both
   * into the Map, and each is still called its own way; each leaves by its id.
   */
  test("an object listener is called as one, through the move to a Map and after a detach", () => {
    const calls: string[] = [];
    const runtime = {
      name: "runtime",
      reBuild(this: { name: string }) {
        calls.push(this.name);
      },
    };
    const state = State.heardBy(1, 1, runtime);
    state.set(2);
    state[attach]({ id: 2, onChange: () => calls.push("row") });
    state.set(3);
    state[detach](2);
    state.set(4);
    state[detach](1);
    state.set(5);
    expect(calls).toEqual(["runtime", "runtime", "row", "runtime"]);
  });
});
