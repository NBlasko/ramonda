import { installDom as installLinkedom, installWindow } from "@ramonda/server";

/**
 * The DOM a server render runs against — the package's, plus the jsdom option this app measures
 * against it.
 *
 * **The installer itself now ships from `@ramonda/server`.** What is left here is only the second
 * implementation: `RAMONDA_DOM=jsdom` goes back to it, and it stays because a difference that shows
 * up under one implementation is much easier to diagnose when both are one variable apart.
 *
 * linkedom is the default, and the reason is measured — on a 30-row page, production core build:
 *
 * | | Node built-ins | build DOM | render | per request |
 * | --- | --- | --- | --- | --- |
 * | jsdom | 10 | 4.814 ms | 3.716 ms | 8.530 ms |
 * | linkedom | 0 | 0.018 ms | 0.644 ms | 0.662 ms |
 *
 * The build cost dominates and it is paid PER REQUEST — 4.8 ms of every jsdom request went on
 * constructing a DOM before any rendering began. End to end on a live dynamic route, 9.49 ms
 * against 2.97 ms. Needing no Node built-in is the other half, and the half that decides it: that
 * is what lets a server render run on Cloudflare Workers, Deno Deploy or Vercel Edge.
 *
 * **The smoke test still loads the client bundle into jsdom**, which is not an inconsistency —
 * there it stands in for a BROWSER, hydrating and clicking. This module is only about the DOM the
 * SERVER renders into.
 */
export async function installDom(url) {
  if (process.env.RAMONDA_DOM !== "jsdom") return installLinkedom(url);

  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });
  installWindow(url, dom.window);
  /**
   * jsdom's `close()` is real work: it stops the window's timers and detaches its event loop, which
   * a long-lived server needs or every request leaves one behind. linkedom has nothing to stop,
   * which is why the handle exists rather than the DOM — the caller shuts either down the same way.
   */
  return { close: () => dom.window.close() };
}

export const domName = () => (process.env.RAMONDA_DOM === "jsdom" ? "jsdom" : "linkedom");
