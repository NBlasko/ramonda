/**
 * Quiet scrolling where there is nothing to scroll.
 *
 * jsdom has no layout, and its `scrollTo` and `scrollBy` print "Not implemented" instead of doing
 * nothing. The router scrolls to the top on every `push`, so every test that navigated printed it —
 * found by the second trial, a line of noise in every run that said nothing about the app. A page
 * with no layout has no position to change, so doing nothing IS the right answer there.
 *
 * Only under jsdom, told by its own user agent, so a browser-based test runner keeps real scrolling.
 */
if (typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom")) {
  const nothing = (): void => {};
  window.scrollTo = nothing as typeof window.scrollTo;
  window.scrollBy = nothing as typeof window.scrollBy;
}

export {};
