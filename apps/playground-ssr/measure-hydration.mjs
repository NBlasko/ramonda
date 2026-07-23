/**
 * Measures hydration against the LIVE server: fetches one page over HTTP from
 * the separate Node process, then hydrates it with the real App and counts every
 * dev diagnostic that fires.
 *
 * The single-process vitest tests cannot answer this — they build the server
 * markup in the same jsdom that hydrates it. Here the markup has been through a
 * real serializer, a socket, and a real HTML parser, which is exactly the path
 * that produced RMD007's normalized `display: contents;`.
 *
 * One route per process, deliberately: the framework reads `document` while its
 * module graph loads, so a second route in the same process would hydrate
 * against a jsdom the modules never saw.
 *
 * Usage: node measure-hydration.mjs [path]   (server must be running)
 */
import { JSDOM } from "jsdom";

const PORT = Number(process.env.PORT ?? 5180);
const route = process.argv[2] ?? "/";
const url = `http://localhost:${PORT}${route}`;

const html = await fetch(url).then((r) => r.text());
const dom = new JSDOM(html, { url });

// Installed BEFORE the bundle is imported: the framework touches `document` as
// its modules evaluate, so a later install would come too late.
const put = (name, value) =>
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
for (const name of [
  "window",
  "document",
  "navigator",
  "location",
  "HTMLElement",
  "SVGElement",
  "Node",
  "Element",
  "Event",
  "CustomEvent",
  "MutationObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "getComputedStyle",
]) {
  const value = name === "window" ? dom.window : dom.window[name];
  if (value !== undefined) put(name, value);
}

const diagnostics = [];
dom.window.addEventListener("ramonda:dev-log", (event) => {
  diagnostics.push(event.detail.message.split("\n")[0]);
});

const { hydrateRoot, appNode } = await import("./dist/measure/measure.js");

const root = dom.window.document.querySelector("#app");
if (!root) {
  console.log(`${route}: no #app in the server markup`);
  process.exit(1);
}

// Counted before hydrating: this is what the server actually shipped.
const hosts = dom.window.document.querySelectorAll("ramonda-host").length;
const styled = dom.window.document.querySelectorAll("ramonda-host[style]").length;

hydrateRoot(appNode(), root);
await new Promise((resolve) => setTimeout(resolve, 50));

const coded = diagnostics.filter((message) => /^\[RMD\d+\]/.test(message));
console.log(`${route}  bytes=${html.length}  hosts=${hosts} (styled: ${styled})  diagnostics=${coded.length}`);
for (const message of coded) console.log(`    ${message}`);

process.exit(coded.length > 0 ? 1 : 0);
