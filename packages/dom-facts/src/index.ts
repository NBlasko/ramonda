/**
 * Facts about the DOM that the framework and the checker have to agree on.
 *
 * ## Why this package exists
 *
 * `@ramonda/core` decides how to build an element; `@ramonda/check` reads source and says what that
 * decision will be. When the two disagree, the checker is confidently wrong about real markup —
 * which is worse than having no checker, because a report that is trusted and false sends somebody
 * to change a line that was right.
 *
 * The SVG list below was the case that proved it. Written into the checker as a first guess, it was
 * twenty-one tags short and wrongly claimed `title`, which the framework renders as HTML. A test
 * that read the other package's SOURCE caught it — but a test that pins two lists together is a
 * confession that there are two lists.
 *
 * ## Why it is private, and why that costs nothing
 *
 * It publishes nothing and is a devDependency everywhere. Both consumers bundle their own code, and
 * tsup inlines anything that is not a declared `dependency` — so `@ramonda/core` ships exactly the
 * bytes it shipped before, and `@ramonda/check` still publishes with no runtime dependency at all,
 * which is the property that lets it run first in a build.
 *
 * ## What may go in here
 *
 * A fact about the DOM or about HTML that BOTH packages need, and nothing else. Not a helper, not a
 * type shared for convenience, and nothing either package could keep to itself — a shared package
 * with no rule about what it holds becomes the place things go to avoid a decision.
 */

/**
 * The tags built with `createElementNS(svgNamespaceUri, …)` instead of `createElement`.
 *
 * **SVG-ness is decided by NAME, not by tree context** — which is why HTML inside `<foreignObject>`
 * comes out as HTML, as SVG requires, and why `<circle>` is SVG wherever it is written.
 *
 * It must hold every tag `global.ts` types as `SVGArgs<…>`. A name that is typed but missing here
 * fails silently: `createElement` accepts anything, so the tag becomes an unknown HTML element that
 * looks right in the DOM and never renders as SVG. Eight of them were (`tspan`, `textPath`,
 * `foreignObject`, `image`, `desc`, `metadata`, `mpath`, `switch`) — the two lists lived in
 * different files and neither imported the other, so nothing noticed.
 * `@ramonda/core`'s `SvgNamespace.test.tsx` pins them to each other in both directions.
 *
 * The checker needs the same list for a different question: an attribute NAME survives as written
 * on an SVG element, because `setAttributeNS(null, name)` does not lowercase, while `setAttribute`
 * does. So `aria-labelledBy` works on a `<span>` and is dead on a `<circle>`.
 */
export const svgElements: ReadonlySet<string> = new Set([
  "svg",
  "circle",
  "rect",
  "path",
  "g",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "image",
  "text",
  "tspan",
  "textPath",
  "foreignObject",
  "switch",
  "use",
  "defs",
  "desc",
  "metadata",
  "mpath",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "mask",
  "clipPath",
  "symbol",
  "marker",
  "view",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
]);

/**
 * The HTML boolean attributes, as the spec defines them: present means true.
 *
 * A boolean attribute carries no value — the parser reads only whether it is there. `@ramonda/core`
 * needs that to WRITE one: `disabled="true"` behaves correctly and is not what HTML says, so `true`
 * goes out as the empty string, which is also what a browser gives back from `outerHTML`. The same
 * list decides RMD029, which reports the string `"false"` on one of these names — an attribute that
 * turns the control ON while the line says otherwise.
 *
 * `@ramonda/check` reads the same source and has to reach the same verdict without running it, and
 * that is the reason this is here rather than in `core`: the checker's rule for it is not written
 * yet, and `svgElements` is the proof that the second copy is made before anyone notices. A list
 * that two packages will both consult is one list from the beginning or it is two lists later.
 *
 * `aria-*` is deliberately absent. ARIA attributes are enumerated STRINGS, not boolean attributes:
 * `aria-hidden="false"` is valid and means "not hidden", and `aria-hidden=""` would be neither.
 * `data-*` is absent for the same reason — its value is data, and an empty one is not the same as
 * `"true"` to whatever reads it back.
 */
export const BOOLEAN_ATTRIBUTES = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected",
]);
