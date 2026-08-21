import ts from "typescript";
import { htmlElements, svgElements } from "@ramonda/dom-facts";
import { positionOf } from "../syntax";
import { hostTagOf } from "./html";
import type { Rule } from "./rule";

/**
 * `@Host` naming something that is not an element.
 *
 * The host element is what a component IS — every attribute it takes, every listener `@onElement`
 * binds, and the box its children land in. `@Host("dvi")` produces `<dvi>`: `createElement` accepts
 * any name, so nothing throws, the DOM contains it, and it renders as an unknown inline element that
 * looks almost right until a layout is put on it.
 *
 * ## Three ways a tag is fine, and they are the whole set
 *
 * - **An HTML element**, by the names this framework TYPES as one — `htmlElements` in
 *   `@ramonda/dom-facts`, pinned to `JSX.IntrinsicElements` in both directions by a test in core.
 *   What makes a name an element here is what the framework accepts, not what a specification
 *   listed this year.
 * - **An SVG element**, by name and by CASE: `clipPath` is the element and `clippath` is not one.
 *   SVG-ness is decided by name rather than by tree context, which is why the case matters at all.
 * - **Anything with a DASH.** That is what the HTML standard reserves for a custom element, and
 *   inventing `<my-widget>` is a thing people do on purpose.
 *
 * ## Why a static rule when core already checks
 *
 * `assertHostTag` refuses a malformed name at decoration time, and it is `__DEV__`-only and fires
 * when the class is DEFINED — which for a component behind a route nobody opened is never, in the
 * build that ships. It also judges only the SHAPE of the name: `dvi` passes its pattern happily.
 *
 * ## What it will not say
 *
 * **A tag CALLBACK.** `@Host((p) => p.as ?? "div")` is computed from props and has no single answer;
 * core says the same of it and re-checks what it returns on every call. **A name the walk cannot
 * settle**, for the reason everything unreadable is left alone. Both are silences, and both are the
 * contract rather than a gap.
 */
export interface HostTagIsNotAnElementIssue {
  /** The component. */
  component: string;
  /** The tag as written, which is what the reader has to find on the line. */
  tag: string;
  /** Which of the two it is, because the sentence differs. */
  kind: "not a name" | "not an element";
  file: string;
  line: number;
  column: number;
}

/**
 * The names the DOM will take as an element name at all — core's own pattern, spelled the same way.
 *
 * A tag failing this is refused by `assertHostTag` at runtime, in development, when the class is
 * defined. This says it for a class that is never defined in the build that ships.
 */
const A_NAME = /^[a-zA-Z][a-zA-Z0-9-]*$/;

export const hostTagIsNotAnElement = {
  id: "host-tag-is-not-an-element",

  report: {
    severity: "warn",
    reportedWhen: "a `@Host` tag names neither an HTML nor an SVG element, and has no dash to make it a custom one",
    alsoReportedAs: "RMD044",
    heading: (found) => `${found.length} \`@Host\` tag(s) that name no element:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.kind === "not a name"
        ? `    <${issue.component}> hosts \`${issue.tag}\`, which the DOM will not take as an element name.`
        : `    <${issue.component}> hosts \`<${issue.tag}>\`, which is no HTML or SVG element and has no dash.`,
    ],
    advice:
      "The host element is what a component IS — the attributes it takes, the box its children land\n" +
      "in, and what `@onElement` binds to. A name that is not an element still renders:\n" +
      "`createElement` accepts anything, so `<dvi>` appears in the DOM as an unknown inline element\n" +
      "and only the layout gives it away.\n\n" +
      "Three things are fine, and they are the whole set: an HTML element, an SVG element by name AND\n" +
      "case (`clipPath`, not `clippath`), and anything with a DASH — which is what the standard\n" +
      "reserves for a custom element, so `<my-widget>` is deliberate and is never reported.\n\n" +
      'A tag computed from props — `@Host((p) => p.as ?? "div")` — is not judged here. It has no\n' +
      "single answer, and the framework re-checks what it returns on every call.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self, resolve }) {
    const tag = hostTagOf(cls, resolve);
    if (tag === undefined) return [];

    // A dash is the standard's own marker for a custom element, and inventing one is the point.
    if (tag.includes("-")) return [];

    const kind = !A_NAME.test(tag)
      ? ("not a name" as const)
      : htmlElements.has(tag.toLowerCase()) || svgElements.has(tag)
        ? undefined
        : ("not an element" as const);

    if (kind === undefined) return [];

    const at = ts.getDecorators(cls)?.[0] ?? cls;
    return [{ component: self.name, tag, kind, ...positionOf(at) }];
  },
} as const satisfies Rule<HostTagIsNotAnElementIssue>;
