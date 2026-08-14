/**
 * The plumbing a Ramonda server render needs, so an app does not write it again.
 *
 * Every SSR app here had grown its own copy of these — a DOM installer, a shell filler, a cookie
 * parser — and the copies drifted. Two faults were found and fixed in ONE copy each: an unescaped
 * `<title>`, and a `$` sequence in a render corrupting the page through `String.replace`. The
 * scaffolded template still shipped both. That is the whole argument for this package: a fix that
 * has to be applied by hand to every app reaches one of them.
 *
 * What is NOT here: routing, the ISR cache and the route plan, which are `@ramonda/router/server`.
 * This package knows nothing about routes.
 */

export { escapeHtml, fillDocument, type Document } from "./document";
export { installDom, installWindow, type DomHandle } from "./dom";
export { mimeFor, parseCookies } from "./request";
