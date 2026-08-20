import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Component } from "../base/Component";
import { compute, memoized, state } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";
import { configureDev } from "../index";
import { getDOM } from "../test/setup";

/**
 * A cached render is NOTED, not warned about, because caching one is a legitimate choice.
 *
 * `@compute render()` and `@memoized render()` are allowed — forbidding them protected nobody, since a
 * `@compute` body returned from `render` does the same thing and was always legal. So the cost is STATED:
 * the check calls `render()` twice and compares, and a cache makes the two calls one answer.
 *
 * On the log channel at `info`, and once per component — not as an `RMD` code and not as a warning. A
 * warning on a deliberate choice is how a codebase learns to scroll past warnings, and a code would put it
 * in the list of faults to sweep for. It reports nothing and asks for nothing; it says what it could not
 * see.
 *
 * **Asked of a MARK, not of identity**, and the silences below are why. Identity was the first attempt:
 * comparing the two outputs for sameness catches the cached render and also catches
 * `render() { return this.props.children }` and `render() { return A_CONSTANT }` — measured, both hand back
 * the same object, and neither hides anything the parent did not already check.
 */

const CONSTANT = <b>steady</b>;

let logs: string[] = [];

beforeEach(() => {
  configureDev({ strictRender: true });
  resetDiagnostics();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  configureDev({ strictRender: false });
  vi.restoreAllMocks();
});

const said = () => logs.join("\n");

describe("a cached render", () => {
  test("@compute on render is noted, and the note says what was lost", async () => {
    class Cached extends Component {
      @state n = 1;
      @compute
      render() {
        // An inline handler, which an uncached render would have reported.
        return <button type="button" onclick={() => this.n++} />;
      }
    }

    await getDOM<Cached>(<Cached />);

    expect(said()).toContain("has a cached render");
    // An INFO line, not a warning. The message names RMD020 because that is the check that went blind;
    // what matters is that nothing scolds, so the label is the assertion.
    expect(said()).toContain("Ramonda Info");
    expect(said()).not.toContain("Ramonda Warning");
    // The point of the verdict: the handler inside is NOT what it reports, because it never saw it.
    expect(said()).not.toContain("the source is the same");
  });

  test("@memoized on render is noted the same way", async () => {
    class Memoised extends Component {
      @state n = 1;
      @memoized
      render() {
        return <button type="button" onclick={() => this.n++} />;
      }
    }

    await getDOM<Memoised>(<Memoised />);

    expect(said()).toContain("has a cached render");
  });

  test("an uncached render still reports what is inside it", async () => {
    class Plain extends Component {
      @state n = 1;
      render() {
        return <button type="button" onclick={() => this.n++} />;
      }
    }

    await getDOM<Plain>(<Plain />);

    expect(said()).toContain("the source is the same");
    expect(said()).not.toContain("has a cached render");
  });

  test("a passthrough render is not called cached, though its output is one object", async () => {
    class Passthrough extends Component<{ children?: unknown }> {
      render() {
        return this.props.children as never;
      }
    }

    await getDOM(
      <Passthrough>
        <span>y</span>
      </Passthrough>,
    );

    expect(said()).not.toContain("has a cached render");
  });

  test("nor is a render that returns a module constant", async () => {
    class Constant extends Component {
      render() {
        return CONSTANT;
      }
    }

    await getDOM<Constant>(<Constant />);

    expect(said()).not.toContain("has a cached render");
  });

  /**
   * Stated rather than left to be discovered: the workaround is NOT detected.
   *
   * Nothing at the decoration site says the compute will be returned by the render, and at comparison time
   * it is indistinguishable from the two legitimate shapes above.
   */
  test("a @compute body returned from render is not detected", async () => {
    class ViaBody extends Component {
      @state n = 1;
      @compute get body() {
        return <button type="button" onclick={() => this.n++} />;
      }
      render() {
        return this.body;
      }
    }

    await getDOM<ViaBody>(<ViaBody />);

    expect(said()).not.toContain("has a cached render");
    // And the handler inside it is invisible too, which is the whole reason this limit is written down.
    expect(said()).not.toContain("the source is the same");
  });

  test("it is said once per component, not once per commit", async () => {
    class Cached extends Component {
      @state n = 1;
      @compute
      render() {
        return <button type="button" onclick={() => this.n++} />;
      }
    }

    const app = await getDOM<Cached>(<Cached />);
    app.instance.n = 2;
    await app.settle();
    app.instance.n = 3;
    await app.settle();

    const times = logs.filter((line) => line.includes("has a cached render")).length;
    expect(times).toBe(1);
  });
});
