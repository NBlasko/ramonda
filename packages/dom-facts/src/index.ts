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
