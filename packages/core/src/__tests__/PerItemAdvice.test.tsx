import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { compute, memoized } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";
import { configureDev } from "../index";

/**
 * The advice for a value built per item, followed to the end.
 *
 * Found by an agent building a tournament page from the docs alone: one schedule per group, each built
 * from the group's fixtures. RMD020 said a `@compute` cannot help per item and sent it to `@memoized`;
 * `@memoized rounds(fixtures)` was then refused by RMD047, because an array is no cache key. Each
 * message was right alone and together they went in a circle. What worked was the thing RMD020 ruled
 * out: one `@compute` building every group's value, read by the group's id.
 *
 * So both messages name both ways out, and the first says what to pass.
 */
interface Group {
  id: string;
  fixtures: number[];
}
const GROUPS: Group[] = [
  { id: "a", fixtures: [1, 2] },
  { id: "b", fixtures: [3] },
];

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

describe("RMD020 on a value built per item", () => {
  test("says to call @memoized with the item's id, and names one @compute keyed by id", async () => {
    class Page extends Component {
      render() {
        return (
          <div>
            {GROUPS.map((group) => (
              <section key={group.id} data-rounds={group.fixtures.map((f) => f * 2) as never} />
            ))}
          </div>
        );
      }
    }
    await getDOM<Page>(<Page />);
    const said = logs.join("\n");
    expect(said).toContain("RMD020");
    expect(said).toContain("the item's id");
    expect(said).toContain("one `@compute`");
    expect(said).not.toContain("a `@compute` belongs to the component, not to the row");
  });

  test("and the @compute it names is quiet", async () => {
    class Page extends Component {
      @compute get roundsById(): Record<string, number[]> {
        return Object.fromEntries(GROUPS.map((group) => [group.id, group.fixtures.map((f) => f * 2)]));
      }
      render() {
        return (
          <div>
            {GROUPS.map((group) => (
              <section key={group.id} data-rounds={this.roundsById[group.id] as never} />
            ))}
          </div>
        );
      }
    }
    await getDOM<Page>(<Page />);
    expect(logs.join("\n")).not.toContain("RMD020");
  });
});

describe("RMD047, which RMD020's advice could lead to", () => {
  test("names the same @compute, so it is not a dead end", async () => {
    class Page extends Component {
      @memoized
      rounds(fixtures: number[]) {
        return fixtures.map((f) => f * 2);
      }
      render() {
        return (
          <div>
            {GROUPS.map((group) => (
              <section key={group.id} data-rounds={this.rounds(group.fixtures) as never} />
            ))}
          </div>
        );
      }
    }
    await expect(getDOM(<Page />)).rejects.toThrow(/one `@compute`/);
  });
});
