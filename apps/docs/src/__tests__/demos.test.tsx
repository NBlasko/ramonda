import { bootstrap, configureDev, h, unmount } from "@ramonda/core";
import type { VNode } from "@ramonda/core";
import { flushSync } from "@ramonda/core/testing";
import { describe, expect, test, vi } from "vitest";
import { demos } from "../demos/index";

(globalThis as unknown as { h: typeof h }).h = h;

/**
 * Every demo on the site, mounted with RMD020's double render ON.
 *
 * A demo is code people copy, so one that builds a handler inline teaches exactly what
 * the diagnostic exists to prevent. This is the tripwire: add a demo with an inline
 * arrow, an inline style object or a rebuilt list `each`, and this fails with the
 * component and the attribute named.
 *
 * It also catches a demo that cannot mount at all, which the prerender would only
 * catch later and less clearly.
 */
describe("published demos", () => {
  test("none of them report RMD020", () => {
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
        bootstrap(h(Demo as never, null) as VNode, container);
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

      for (const report of logs.filter((line) => line.includes("RMD020"))) {
        // Keep what the message says, so a failure names the attribute rather than
        // only the demo.
        const detail = report
          .replace(/%c/g, " ")
          .replace(/[^;]*;/g, "")
          .replace(/\s+/g, " ");
        offenders.push(`${name}: ${detail.slice(0, 160)}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
