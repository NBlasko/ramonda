import { bootstrap, configureDev, __h, unmount } from "@ramonda/core";
import type { RamondaNode, VNode } from "@ramonda/core";
import { flushSync } from "@ramonda/core/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DataTable } from "../DataTable";
import { Markdown } from "../Markdown";
import type { ContentNode } from "../content-types";
import { pageLoaders } from "../generated/page-loaders";

/**
 * What a prose table becomes in the DOM.
 *
 * The narrow-screen layout is CSS, which a jsdom test cannot see. What it CAN hold still is the one
 * thing the CSS depends on and cannot derive: `data-label` on every cell but the first, carrying that
 * column's heading. Lose it and the reflow silently renders a stack of unlabelled values.
 */

let host: HTMLElement | undefined;

function mount(node: RamondaNode): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  bootstrap(node as VNode, host);
  flushSync();
  return host;
}

afterEach(() => {
  if (host) {
    unmount(host);
    host.remove();
    host = undefined;
  }
});

/** A built table tree, in the shape build-content.mjs emits — whitespace text nodes included. */
const tableTree: ContentNode = {
  t: "table",
  c: [
    "\n",
    {
      t: "thead",
      c: [
        "\n",
        {
          t: "tr",
          c: [
            { t: "th", c: [""] },
            { t: "th", c: ["Runs on"] },
          ],
        },
      ],
    },
    "\n",
    {
      t: "tbody",
      c: [
        "\n",
        {
          t: "tr",
          c: [
            { t: "td", c: ["@state"] },
            { t: "td", c: ["both"] },
          ],
        },
      ],
    },
  ],
};

describe("a prose table", () => {
  test("carries its column heading on every cell but the first", () => {
    const cells = mount(__h(Markdown, { tree: [tableTree] })).querySelectorAll("tbody td");

    expect(cells.length).toBe(2);
    // The first cell IS the row's name, so it gets the sticky bar rather than a heading.
    expect(cells[0]!.getAttribute("data-label")).toBe(null);
    expect(cells[0]!.textContent).toBe("@state");
    expect(cells[1]!.getAttribute("data-label")).toBe("Runs on");
  });

  test("keeps the markup a real table, so a wide screen is unaffected", () => {
    const table = mount(__h(Markdown, { tree: [tableTree] })).querySelector("table");

    expect(table).not.toBe(null);
    expect(table!.querySelectorAll("thead th").length).toBe(2);
    expect(table!.parentElement!.className).toBe("table-wrap");
  });

  test("a cell keeps its inline markup", () => {
    const rich: ContentNode = {
      t: "table",
      c: [
        {
          t: "thead",
          c: [
            {
              t: "tr",
              c: [
                { t: "th", c: ["Name"] },
                { t: "th", c: ["Note"] },
              ],
            },
          ],
        },
        {
          t: "tbody",
          c: [
            {
              t: "tr",
              c: [
                { t: "td", c: [{ t: "code", c: ["@state"] }] },
                { t: "td", c: ["see ", { t: "strong", c: ["this"] }] },
              ],
            },
          ],
        },
      ],
    };
    const row = mount(__h(Markdown, { tree: [rich] })).querySelector("tbody tr")!;

    expect(row.querySelector("code")!.textContent).toBe("@state");
    // Several nodes in one cell, all of them kept.
    expect(row.children[1]!.textContent).toBe("see this");
    expect(row.children[1]!.querySelector("strong")).not.toBe(null);
  });

  test("takes data directly, so a page can build one in TSX", () => {
    const table = mount(
      __h(DataTable, {
        columns: ["Code", "Means"],
        rows: [["RMD001", "a write during render"]],
      }),
    );

    expect(table.querySelector("tbody td")!.textContent).toBe("RMD001");
    expect(table.querySelectorAll("tbody td")[1]!.getAttribute("data-label")).toBe("Means");
  });
});

/**
 * The widest table on the site is the decorator reference — four columns, and the one that made this
 * component necessary. If a build ever stops routing it through DataTable, this says so.
 */
describe("the published pages", () => {
  test("every table in the content is labelled", async () => {
    let tables = 0;

    const reports: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      const line = args.map(String).join(" ");
      if (line.includes("RMD020")) reports.push(line.replace(/%c/g, " ").slice(0, 160));
    });
    // The strict render is what catches a table converted afresh on every render: `rows` would be a
    // new array each time, and a component's props are compared by reference.
    configureDev({ strictRender: true });

    for (const load of Object.values(pageLoaders)) {
      const loaded = (await load()) as Record<string, unknown>;
      const Page = (loaded["default"] ?? loaded["Page"]) as Parameters<typeof __h>[0];
      const container = document.createElement("div");
      document.body.appendChild(container);
      bootstrap(__h(Page, {}) as VNode, container);
      flushSync();

      for (const table of container.querySelectorAll("table")) {
        tables++;
        expect(table.parentElement!.className).toBe("table-wrap");
        for (const row of table.querySelectorAll("tbody tr")) {
          for (const cell of [...row.children].slice(1)) {
            expect(cell.getAttribute("data-label")).not.toBe(null);
          }
        }
      }

      unmount(container);
      container.remove();
    }

    configureDev({ strictRender: false });
    spy.mockRestore();

    expect(reports).toEqual([]);
    // The census the build produces today; a drop to zero would mean the walk stopped finding them.
    expect(tables).toBeGreaterThan(20);
    // Importing and mounting every page is real work, and it runs alongside the rest of the
    // monorepo's tasks. The ceiling is here so a hang fails rather than hanging; it is not a
    // measurement of anything.
  }, 60_000);
});
