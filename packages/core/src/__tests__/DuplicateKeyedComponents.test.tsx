import { describe, test, expect, beforeEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { state, destroyed } from "../base/decorators";
import { Component } from "../base/Component";
import { componentsIn } from "../core/DiffAndMerge";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * Two sibling components answering the SAME key.
 *
 * User error, and reported as `RMD002` — but the page has to survive it, and survive it on every
 * render rather than once. A region is matched by its owner, which IS the key when the parent wrote
 * one, so two of them collide in the index the diff builds of what was there last time. One entry
 * per owner means the loser is not in the index at all: nothing claims it, and the teardown at the
 * end only walks the index — so its nodes stay in the DOM forever and its `@destroyed` never runs.
 * Once per render, for as long as the mistake is in the source.
 */

let gone: string[] = [];

beforeEach(() => {
  resetDiagnostics();
  gone = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("two components with the same key", () => {
  test("the parent's re-render neither grows the DOM nor loses a teardown", async () => {
    class Row extends Component<{ label: string }> {
      @destroyed
      say(): void {
        gone.push(this.props.label);
      }

      render() {
        return <li>{this.props.label}</li>;
      }
    }

    class Table extends Component {
      @state pass = 0;

      render() {
        return (
          <ul id="rows">
            {[<Row key="a" label={`first-${this.pass}`} />, <Row key="a" label={`second-${this.pass}`} />]}
          </ul>
        );
      }
    }

    const { container, settle } = await getDOM(<Table />);
    const rows = container.querySelector("#rows")!;
    const table = componentsIn(container).find((c) => c.constructor.name === "Table") as unknown as {
      pass: number;
    };

    expect(rows.children).toHaveLength(2);

    for (let pass = 1; pass <= 3; pass++) {
      table.pass = pass;
      await settle();

      // Two rows are rendered, so two are on the page — however many passes have run.
      expect(rows.children).toHaveLength(2);
      expect([...rows.children].map((el) => el.textContent)).toEqual([`first-${pass}`, `second-${pass}`]);

      // And the instance that is no longer on the page was torn down, once per pass. A component with
      // a subscription, a timer or an event listener in `@destroyed` is otherwise still holding them.
      expect(gone).toHaveLength(pass);
      expect(componentsIn(container).filter((c) => c.constructor.name === "Row")).toHaveLength(2);
    }
  });
});
