import { bootstrap, configureDev, __h, unmount } from "@ramonda/core";
import { flushSync } from "@ramonda/core/testing";
import { describe, expect, test, vi } from "vitest";
import { demos } from "../demos/index";

/**
 * Every demo on the site, mounted with the strict render ON — so both stability checks
 * run: RMD020 over what `render()` returned, RMD022 over what a hook's props callback
 * returned.
 *
 * A demo is code people copy, so one that builds a handler inline teaches exactly what
 * the diagnostics exist to prevent. This is the tripwire: add a demo with an inline
 * arrow, an inline style object, a rebuilt list `each` or a rebuilt query key, and this
 * fails with the component and the attribute named.
 *
 * It also catches a demo that cannot mount at all, which the prerender would only
 * catch later and less clearly.
 */
describe("published demos", () => {
  test("none of them report RMD020 or RMD022", () => {
    const offenders: string[] = [];

    for (const [name, Demo] of Object.entries(demos)) {
      const container = document.createElement("div");
      document.body.appendChild(container);

      const logs: string[] = [];
      const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
      configureDev({ strictRender: true });

      try {
        bootstrap(__h(Demo as never, null), container);
        flushSync();
      } catch (error) {
        offenders.push(`${name}: threw ${(error as Error).message}`);
      } finally {
        try {
          unmount(container);
        } catch {
          // A demo that failed to mount has nothing to tear down.
        }
        container.remove();
        configureDev({ strictRender: false });
        spy.mockRestore();
      }

      for (const report of logs.filter((line) => line.includes("RMD020") || line.includes("RMD022"))) {
        // Keep what the message says, so a failure names the attribute rather than
        // only the demo.
        // Strip the console styling only — CSS argument groups look like `a: b; c: d`,
        // and a blanket "drop everything up to a semicolon" swallowed the message itself,
        // which has semicolons of its own.
        const detail = report
          .replace(/%c/g, " ")
          .replace(/(?:[a-z-]+\s*:[^;]*;\s*)+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        offenders.push(`${name}: ${detail.slice(0, 200)}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
