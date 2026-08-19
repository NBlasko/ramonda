import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * RMD060 — `render()` that returns a promise.
 *
 * The type system refuses this, and that is exactly why it is worth reporting: a `@ts-ignore` or a
 * loosened base class defeats the refusal, and what happens then is a `TypeError` thrown from
 * inside `DiffAndMerge` whose stack is entirely framework frames — it names neither the component
 * nor `render()`. Measured, not assumed: the probe that motivated this reported
 * `TypeError: component is not a constructor` at `DiffAndMerge.ts:1354` and nothing else.
 */

let logs: string[] = [];

beforeEach(() => {
  resetDiagnostics();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => vi.restoreAllMocks());

const reported = () => logs.join("\n");

describe("RMD060", () => {
  test("an async render() is named before the diff throws over it", async () => {
    class Slow extends Component {
      // @ts-expect-error — the type refuses this, which is the whole point: one comment defeats it,
      // and this test is about what happens to somebody who wrote that comment.
      async render() {
        return <p>hello</p>;
      }
    }

    // The diff still throws — this diagnostic does not rescue the render, it explains it.
    await expect(getDOM(<Slow />)).rejects.toThrow();

    expect(reported()).toContain("RMD060");
    expect(reported()).toContain("Slow");
    expect(reported()).toContain("returns a promise, not markup");
  });

  test("an ordinary render is silent", async () => {
    class Fine extends Component {
      render() {
        return <p>hello</p>;
      }
    }

    const { container } = await getDOM(<Fine />);

    expect(reported()).not.toContain("RMD060");
    expect(container.innerHTML).toContain("hello");
  });
});
