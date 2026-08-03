/**
 * The DOM a server render runs against, from one place, so both implementations can be measured
 * against the same app.
 *
 * `RAMONDA_DOM=linkedom` swaps jsdom for linkedom. That is not a preference switch for an app to
 * ship — it exists so the smoke test can run the WHOLE suite on either, which is the only honest way
 * to find out whether a lighter DOM is enough. Measured on a 30-row page, production core build:
 *
 * | | Node built-ins | build DOM | render | per request |
 * | --- | --- | --- | --- | --- |
 * | jsdom | 10 | 4.814 ms | 3.716 ms | 8.530 ms |
 * | linkedom | 0 | 0.018 ms | 0.644 ms | 0.662 ms |
 *
 * The build cost is what dominates, and it is paid PER REQUEST — 4.8 ms of every request today goes
 * on constructing a DOM before any rendering starts. linkedom needing no Node built-in is the other
 * half: it is what would let this run on Cloudflare Workers, Deno Deploy or Vercel Edge, where jsdom
 * cannot go at all.
 */

/**
 * defineProperty, not assignment: Node ships `navigator` and `location` as getter-only globals, so
 * `globalThis.navigator = …` throws outright.
 */
const put = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

const GLOBALS = [
  "window",
  "document",
  "navigator",
  "location",
  "HTMLElement",
  "SVGElement",
  "Node",
  "Text",
  "CustomEvent",
  "Event",
  "MouseEvent",
  "getComputedStyle",
];

async function jsdomDom(url) {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });
  for (const name of GLOBALS) put(name, dom.window[name]);
  return dom;
}

async function linkedomDom(url) {
  const { parseHTML } = await import("linkedom");
  const dom = parseHTML("<!doctype html><html><body></body></html>");
  const source = dom.window ?? dom;

  for (const name of GLOBALS) {
    if (source[name] !== undefined) put(name, source[name]);
  }

  /**
   * Three linkedom does not supply, and none of them is a gap in what it renders.
   *
   * `location` — linkedom's `parseHTML` takes no URL, so it has nowhere to get one. The router reads
   * it during a server render, so it is real and it is supplied here from the request's own URL,
   * which is the same thing jsdom is handed.
   *
   * `MouseEvent` and `getComputedStyle` are client-only: nothing dispatches a click or measures a
   * box on the server. They exist so a component that merely REFERENCES them at module scope does
   * not throw on import — a stub is the honest shape, not an omission.
   */
  const parsed = new URL(url);
  put("location", {
    href: parsed.href,
    origin: parsed.origin,
    protocol: parsed.protocol,
    host: parsed.host,
    hostname: parsed.hostname,
    port: parsed.port,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    toString: () => parsed.href,
  });
  if (globalThis.MouseEvent === undefined) put("MouseEvent", source.Event ?? Event);
  if (globalThis.getComputedStyle === undefined) put("getComputedStyle", () => ({ getPropertyValue: () => "" }));

  return dom;
}

/** Swaps in a fresh DOM for one render, and answers with it. */
export async function installDom(url) {
  const dom = process.env.RAMONDA_DOM === "linkedom" ? await linkedomDom(url) : await jsdomDom(url);

  put("requestAnimationFrame", (cb) => setTimeout(() => cb(Date.now()), 0));
  put("cancelAnimationFrame", (id) => clearTimeout(id));

  return dom;
}

export const domName = () => (process.env.RAMONDA_DOM === "linkedom" ? "linkedom" : "jsdom");
