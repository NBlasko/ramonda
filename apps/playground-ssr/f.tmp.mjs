/**
 * Counts DOM mutations inside the panel's Query tab while the cache is idle. Before the fix the
 * whole list was rewritten twice a second; after it, an idle tab should touch nothing.
 */
import { JSDOM } from "jsdom";
const url = "http://localhost:5180/products";
const served = await fetch(url).then((r) => r.text());
const dom = new JSDOM(served, { url, pretendToBeVisual: true, runScripts: "outside-only" });
for (const k of [
  "window",
  "document",
  "location",
  "history",
  "HTMLElement",
  "Element",
  "Node",
  "customElements",
  "CustomEvent",
  "Event",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "getComputedStyle",
  "MutationObserver",
  "IntersectionObserver",
  "fetch",
  "AbortController",
  "setInterval",
  "clearInterval",
])
  Object.defineProperty(globalThis, k, { value: dom.window[k] ?? globalThis[k], configurable: true, writable: true });
const realLog = console.error.bind(console);
globalThis.console = dom.window.console;
for (const l of ["log", "info", "warn", "error"]) dom.window.console[l] = () => {};

await import("/home/nikola/Blasko/ramonda-monorepo-2/ramonda/apps/playground-ssr/dist/client/assets/client.js");
await new Promise((r) => setTimeout(r, 500));

const panel = dom.window.document.querySelector("ramonda-devtools");
const root = panel.shadowRoot;
// Open it, and switch to the Query tab the way a click would.
panel.setAttribute("open", "");
root.querySelector('[data-tab="query"]').dispatchEvent(new dom.window.Event("click"));
await new Promise((r) => setTimeout(r, 600));

const container = root.querySelector("#query-container");
let mutations = 0;
const observer = new dom.window.MutationObserver((records) => {
  mutations += records.length;
});
observer.observe(container, { childList: true, subtree: true, characterData: true, attributes: true });

await new Promise((r) => setTimeout(r, 2200)); // ~4 polling ticks at 500ms
observer.disconnect();

realLog(JSON.stringify({ rows: container.querySelectorAll(".q-row").length, mutationsOverFourTicks: mutations }));
