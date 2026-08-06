import { focusOn } from "@ramonda/lens";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../index";

/**
 * A real reporter, end to end: a mistake in application code, and a row in the panel.
 *
 * Every other test of this protocol holds one half of it — that a record on the global
 * reaches the bridge, or that `@ramonda/lens` produces a conforming record. Both can
 * pass while the whole thing is broken, because the two halves are joined by a shape
 * declared twice and a global named in two files, with no type relating them. This is
 * the test that fails if the join is wrong.
 *
 * `@ramonda/lens` is a devDependency for exactly this, and nothing else: it is the
 * smallest package that reports anything, it has no dependencies of its own, and the
 * dependency is one direction only — lens knows nothing about this package, which is
 * the property the whole design exists to keep.
 *
 * It is imported as a PACKAGE rather than by path, so the workspace edge is real and
 * turbo builds it before this runs.
 */

type Panel = HTMLElement & { shadowRoot: ShadowRoot };

interface Row {
  message: string;
  type: string;
  data: Record<string, unknown>;
}

let rows: Row[];
let listening: AbortController;

function listen(): void {
  // Aborted after each case: a listener added per test and never removed counts one
  // event as many times as there have been tests.
  listening = new AbortController();
  window.addEventListener(
    "ramonda:dev-log",
    (event) => {
      rows.push((event as CustomEvent).detail as Row);
    },
    { signal: listening.signal },
  );
}

function panel(): Panel {
  document.body.innerHTML = "";
  const element = document.createElement("ramonda-devtools") as Panel;
  document.body.append(element);
  return element;
}

/** The rendered rows in the Logs tab, newest first — the actual end of the chain. */
const rendered = (element: Panel): string[] =>
  Array.from(element.shadowRoot.querySelectorAll(".log-item")).map((row) => row.textContent ?? "");

beforeEach(() => {
  rows = [];
  listen();
});

afterEach(() => {
  listening.abort();
  document.body.innerHTML = "";
});

/**
 * The rows this case added, newest first.
 *
 * The panel's history outlives one test — the bridge keeps a session vault and replays it
 * to every panel that mounts, which is the behaviour an app wants and a per-test reset
 * would hide. So a case reads the top of the list rather than all of it.
 */
const added = (element: Panel, before: number): string[] =>
  rendered(element).slice(0, rendered(element).length - before);

describe("@ramonda/lens, reporting through the panel", () => {
  /**
   * If this fails, the package resolved to its production build, where every report is
   * compiled out — and every assertion below would be vacuous rather than wrong.
   */
  it("is the development build, so there is anything to collect at all", () => {
    focusOn({ posts: [{ title: "a" }] })
      .get("posts")
      .at(9)
      .get("title")
      .set("x");

    expect(rows).toHaveLength(1);
  });

  it("puts a real mistake in the Logs tab, with its code, its severity and its values", () => {
    const state = { posts: [{ title: "a", tags: ["x"] }] };

    // An index that is not there. The types allow it — the array's length is a runtime fact.
    focusOn(state).get("posts").at(9).get("title").set("renamed");

    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe("[RML004] .posts has 1 element(s), so index 9 is out of range. Nothing was changed.");
    // `warn` in the record, `warning` in the payload: the panel colours by its own word.
    expect(rows[0].type).toBe("warning");
    expect(rows[0].data).toMatchObject({ scope: "ramonda/lens", path: ".posts", index: 9, length: 1 });
    // The fix travels as data, where the panel renders it in a `pre-wrap` block.
    expect(String(rows[0].data.fix)).toContain("negative index counts from the end");
  });

  it("renders it, which is the end of the chain rather than the middle", () => {
    const element = panel();
    const before = rendered(element).length;

    focusOn({ home: { city: "Novi Sad" } })
      .get("home")
      .get("region" as "city")
      .remove();

    const text = added(element, before);
    expect(text).toHaveLength(1);
    expect(text[0]).toContain("[RML007]");
    expect(text[0]).toContain('has no property "region"');
    expect(text[0]).toContain("[WARNING]");
  });

  it("carries an error severity through as an error, and detonates the badge", () => {
    const element = panel();
    const payload = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;

    // A refused key: the code cannot be right whatever the data holds, so it is an error.
    focusOn({ post: { id: 1 } as Record<string, unknown> })
      .get("post")
      .merge(payload);

    expect(rows[0].type).toBe("error");
    expect(rows[0].message).toContain("[RML009]");
    // The panel's own reaction to an error, which is what the severity is FOR.
    expect(element.shadowRoot.querySelector("#badge-count")!.textContent).not.toBe("");
  });

  it("reports the two faults that throw, so the panel sees what a throw would keep to itself", () => {
    const chain = focusOn({ posts: [{ title: "a" }, { title: "b" }] }).get("posts");
    chain.at(0).get("title").set("one");

    expect(() => chain.at(1).get("title").set("two")).toThrow(/RML010/);

    // The throw is loud, but only where somebody is watching the console. The record is
    // what puts it in front of a panel that is already open.
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toContain("[RML010]");
    expect(rows[0].type).toBe("error");
  });

  it("hands a panel that opens later everything reported before it existed", () => {
    // Startup order, which is the order that actually happens: the app runs, reports, and
    // only then does somebody open the panel.
    focusOn({ profile: null as { city: string } | null })
      .get("profile")
      .get("city")
      .set("Niš");
    focusOn({ tags: [] as string[] })
      .get("tags")
      .at(0)
      .set("x");

    // Only now does a panel exist, and it is handed the history rather than starting blank.
    const text = rendered(panel());

    expect(text.slice(0, 2).map((row) => row.match(/RML\d{3}/)?.[0])).toEqual(["RML004", "RML001"]);
  });

  it("says nothing for a write that lands", () => {
    const element = panel();
    const before = rendered(element).length;
    const state = { posts: [{ title: "a" }] };

    const next = focusOn(state).get("posts").at(0).get("title").set("renamed");

    expect(next.posts[0].title).toBe("renamed");
    expect(rows).toEqual([]);
    expect(added(element, before)).toEqual([]);
  });
});
