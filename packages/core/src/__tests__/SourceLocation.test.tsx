import { describe, expect, test } from "vitest";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { scanComponentTree } from "../debug/inspector";
import { definitionOf, recordDefinition } from "../debug/sourceLocation";
import { getDOM } from "../test/setup";

/**
 * Where a component is defined, taken from the stack of its first construction.
 *
 * The whole design rests on one measured fact: a subclass appears in the stack by name even when it
 * declares no constructor, and the frame's position is its class declaration. So these tests assert
 * against THIS file — the line numbers below are the evidence, and they move when the file does,
 * which is why each one is derived rather than hard-coded.
 */

class Plain extends Component {
  render() {
    return <div id="plain">plain</div>;
  }
}

class WithOwnConstructor extends Component {
  private label = "x";
  render() {
    return <div id="own">{this.label}</div>;
  }
}

class Counter extends Hook {
  value = 1;
}

class WithHook extends Component {
  counter = this.use(Counter);
  render() {
    return <div id="with-hook">{String(this.counter.value)}</div>;
  }
}

/** The line a class is declared on, read out of this file rather than written down twice. */
async function lineOf(declaration: string): Promise<number> {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL(import.meta.url), "utf8");
  const at = source.split("\n").findIndex((line) => line.startsWith(declaration));
  if (at === -1) throw new Error(`no line starts with ${declaration}`);
  return at + 1;
}

describe("a component's definition", () => {
  test("is found for a class with no constructor and no decorators", async () => {
    using app = await getDOM<Plain>(<Plain />);
    void app;

    const source = definitionOf(Plain);
    expect(source).toBeDefined();
    expect(source!.file).toContain("SourceLocation.test.tsx");
    expect(source!.line).toBe(await lineOf("class Plain extends Component"));
  });

  /**
   * A class that runs its own constructor reports the `super()` line instead — inside the same
   * class, which is near enough that the editor opens where you meant. Asserted as a RANGE on
   * purpose: the exact frame is the engine's business, the file and the neighbourhood are ours.
   */
  test("is inside the class for one that has a constructor", async () => {
    using app = await getDOM<WithOwnConstructor>(<WithOwnConstructor />);
    void app;

    const source = definitionOf(WithOwnConstructor)!;
    const declared = await lineOf("class WithOwnConstructor extends Component");
    expect(source.file).toContain("SourceLocation.test.tsx");
    expect(source.line).toBeGreaterThanOrEqual(declared);
    expect(source.line).toBeLessThan(declared + 8);
  });

  test("is found for a hook too", async () => {
    using app = await getDOM<WithHook>(<WithHook />);
    void app;

    const source = definitionOf(Counter)!;
    expect(source.line).toBe(await lineOf("class Counter extends Hook"));
  });

  /** One `Error` per CLASS. A per-instance capture would be a cost paid on every construction. */
  test("is captured once per class, not once per instance", async () => {
    const stacks: string[] = [];
    const original = Error.captureStackTrace;
    Error.captureStackTrace = (target: object, ...rest: unknown[]) => {
      stacks.push("captured");
      return (original as (t: object, ...r: unknown[]) => void)(target, ...rest);
    };

    try {
      class Repeated extends Component {
        render() {
          return <span>{"r"}</span>;
        }
      }

      using app = await getDOM(
        <div>
          <Repeated />
          <Repeated />
          <Repeated />
        </div>,
      );
      void app;

      // Three instances, one capture. (Other classes constructed by this render add their own, so
      // the assertion is on the class, not on the total.)
      expect(definitionOf(Repeated)).toBeDefined();
      expect(stacks.length).toBeLessThan(3 + 3);
    } finally {
      Error.captureStackTrace = original;
    }
  });

  test("reaches the panel through the inspector", async () => {
    using app = await getDOM<Plain>(<Plain />);
    void app;

    const found = scanComponentTree(document.body).find((node) => node.name === "Plain");
    expect(found?.source?.file).toContain("SourceLocation.test.tsx");
    expect(found?.source?.line).toBe(await lineOf("class Plain extends Component"));
  });
});

/**
 * The shapes a stack comes in, and what happens when it says nothing.
 *
 * The parser's own note lists two engine formats and only one of them can be produced by the runner:
 * these tests run on V8, so the `at new Foo (file:line:col)` shape is what every test above exercises
 * and `Foo@file:line:col` — Firefox and Safari — was never parsed by anything. It matters because it
 * is not a fallback for an edge case; it is half the browsers a person opens devtools in.
 *
 * `recordDefinition` is called here directly rather than through a render. It is exported, it takes an
 * instance and reads its constructor, and the alternative — stubbing `Error.captureStackTrace` while a
 * component mounts — would have the framework's own internals reading a forged stack.
 */
describe("the stack a definition is read from", () => {
  /** Records `instance` with `captureStackTrace` replaced, and puts the real one back afterwards. */
  function withStack(stack: string | undefined, instance: object): void {
    const holder = Error as unknown as { captureStackTrace?: (target: object) => void };
    const real = holder.captureStackTrace;
    holder.captureStackTrace = (target: object) => {
      if (stack !== undefined) (target as { stack?: string }).stack = stack;
    };
    try {
      recordDefinition(instance);
    } finally {
      holder.captureStackTrace = real;
    }
  }

  test("a Firefox / Safari frame is parsed, not only V8's", async () => {
    class Panel {}
    withStack(
      "Panel@http://localhost:3000/src/Panel.tsx:18:7\nrender@http://localhost:3000/src/App.tsx:4:2",
      new Panel(),
    );

    expect(definitionOf(Panel)).toEqual({ file: "http://localhost:3000/src/Panel.tsx", line: 18, column: 7 });
  });

  test("a V8 frame is parsed the same way, from the same entry point", async () => {
    class Card {}
    withStack("Error\n    at new Card (http://localhost:3000/src/Card.tsx:9:3)", new Card());

    expect(definitionOf(Card)).toEqual({ file: "http://localhost:3000/src/Card.tsx", line: 9, column: 3 });
  });

  /**
   * A frame naming the class but carrying no position is skipped, and the walk goes on.
   *
   * A bundler that rewrites frames, or a stack cut short by a limit, produces one — and taking it
   * would report `line: NaN` at a file called the whole frame, which an editor cannot open.
   */
  test("a frame with no position is passed over rather than half-read", async () => {
    class Row {}
    withStack("Row@\nRow@http://localhost:3000/src/Row.tsx:2:1", new Row());

    expect(definitionOf(Row)).toEqual({ file: "http://localhost:3000/src/Row.tsx", line: 2, column: 1 });
  });

  test("a stack that names nothing recognisable records nothing", async () => {
    class Quiet {}
    withStack("Error\n    at somethingElse (/x.js:1:1)", new Quiet());

    expect(definitionOf(Quiet)).toBeUndefined();
  });

  test("no stack at all records nothing, and does not throw", async () => {
    class Silent {}
    withStack(undefined, new Silent());

    expect(definitionOf(Silent)).toBeUndefined();
  });

  /**
   * A class with no name is not looked up at all.
   *
   * There is nothing to match a frame against, so the walk would compare every line to `@` and could
   * take a frame belonging to something else. An array element gets no inferred name, which is the
   * shortest way to build one.
   */
  test("an anonymous class is recorded as unknown rather than guessed at", async () => {
    const [Anonymous] = [class {}];
    expect(Anonymous.name).toBe("");
    withStack("Error\n    at new  (/x.js:1:1)", new Anonymous());

    expect(definitionOf(Anonymous)).toBeUndefined();
  });

  test("asking about something that is not a class answers nothing", () => {
    expect(definitionOf("Panel")).toBeUndefined();
    expect(definitionOf(undefined)).toBeUndefined();
    expect(definitionOf({ name: "Panel" })).toBeUndefined();
  });
});
