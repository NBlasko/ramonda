import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { state } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * RMD029 — a boolean attribute given the string `"false"`.
 *
 * The element does the opposite of what the line says, silently, and no type catches it: JSX
 * attributes are typed with an index signature, so any value compiles.
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

describe("RMD029", () => {
  test('disabled="false" disables the control, and says so', async () => {
    class Form extends Component {
      render() {
        return <input disabled={"false" as never} />;
      }
    }

    const { container } = await getDOM(<Form />);

    expect(reported()).toContain("RMD029");
    expect(reported()).toContain("the control is disabled and cannot be used");
    // The report is about what really happens, so this has to be true.
    expect((container.querySelector("input") as HTMLInputElement).disabled).toBe(true);
  });

  test('hidden="false" hides the element', async () => {
    class Panel extends Component {
      render() {
        return <section hidden={"false" as never}>content</section>;
      }
    }

    const { container } = await getDOM(<Panel />);

    expect(reported()).toContain("the element is hidden");
    expect((container.querySelector("section") as HTMLElement).hidden).toBe(true);
  });

  test("a real boolean is silent, and works", async () => {
    class Form extends Component {
      @state locked = false;
      render() {
        return <input disabled={this.locked} />;
      }
    }

    const { container, instance, settle } = await getDOM<Form>(<Form />);
    const input = () => container.querySelector("input") as HTMLInputElement;

    expect(reported()).not.toContain("RMD029");
    expect(input().disabled).toBe(false);

    instance.locked = true;
    await settle();
    expect(input().disabled).toBe(true);
  });

  test('the string "true" is silent — it is true, and it says true', async () => {
    class Form extends Component {
      render() {
        return <input disabled={"true" as never} />;
      }
    }

    await getDOM(<Form />);
    expect(reported()).not.toContain("RMD029");
  });

  test('aria-hidden="false" is valid and is left alone', async () => {
    class Panel extends Component {
      render() {
        return <div aria-hidden="false">read me</div>;
      }
    }

    await getDOM(<Panel />);

    // ARIA attributes are enumerated strings, not boolean attributes: "false" is the correct way
    // to say not-hidden, and reporting it would be reporting correct code.
    expect(reported()).not.toContain("RMD029");
  });

  test('data-* carrying "false" is left alone', async () => {
    class Panel extends Component {
      render() {
        return <div data-open="false">x</div>;
      }
    }

    await getDOM(<Panel />);
    expect(reported()).not.toContain("RMD029");
  });

  test("every boolean attribute is covered, not just the famous three", async () => {
    class Media extends Component {
      render() {
        return (
          <div>
            <video muted={"false" as never} />
            <details open={"false" as never} />
            <input required={"false" as never} />
            {/* The tag is refused, and this is a diagnostic about its ATTRIBUTE — see RefusedSelectTag. */}
            {/* @ts-expect-error */}
            <select multiple={"false" as never} />
          </div>
        );
      }
    }

    await getDOM(<Media />);

    for (const outcome of [
      "the media is muted",
      "the element is open",
      "the form will not submit without it",
      "the control accepts several values",
    ]) {
      expect(reported()).toContain(outcome);
    }
  });

  test("reported once per tag and attribute, however many elements", async () => {
    class Rows extends Component {
      render() {
        return (
          <div>
            <input disabled={"false" as never} />
            <input disabled={"false" as never} />
            <input disabled={"false" as never} />
          </div>
        );
      }
    }

    await getDOM(<Rows />);
    expect(reported().split("RMD029").length - 1).toBe(1);
  });
});
