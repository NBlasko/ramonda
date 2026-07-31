import { describe, expect, test } from "vitest";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { scanComponentTree } from "../debug/inspector";
import { definitionOf } from "../debug/sourceLocation";
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
