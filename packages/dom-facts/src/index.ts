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
 * Every tag `@ramonda/core` types as an HTML element — the other half of {@link svgElements}.
 *
 * ## Why it is shared even though only the checker reads it today
 *
 * The rule above is "a fact BOTH packages need", and core does not need this one yet: it decides a
 * namespace with `svgElements` and treats every other name as HTML, so it never asks whether a name
 * is an element at all. It is here anyway, and deliberately — because the moment core wants to ask,
 * a DEV diagnostic about a host that names nothing, the alternative is a second copy of these 116
 * names. That is the failure this package exists to prevent, and the SVG note above is the record of
 * it happening: a first-guess copy that was twenty-one tags short and wrongly claimed `title`.
 *
 * A fact one package reads and the other is plainly about to is not the thing the rule guards
 * against. What it guards against is a helper with no home.
 *
 * ## Where the names come from
 *
 * Generated from core's `JSX.IntrinsicElements` rather than from a specification, and that is the
 * point: what makes a name an element HERE is what the framework accepts, not what the HTML standard
 * happens to list this year. `HtmlElementNames.test.ts` in core reads that source and pins the two
 * in both directions, exactly as `SvgNamespace.test.tsx` pins the SVG list. A name typed and missing
 * from this Set would have a checker calling something no element while the framework accepts it; a
 * name here and no longer typed is a typo it waves through.
 *
 * `@ramonda/check` reads it to answer one question: whether a `@Host` tag names an element at all.
 * A name with a DASH is not judged against it, because a dash is what the HTML standard reserves for
 * a custom element and inventing one is legitimate.
 */
export const htmlElements: ReadonlySet<string> = new Set([
  "a",
  "abbr",
  "address",
  "area",
  "article",
  "aside",
  "audio",
  "b",
  "base",
  "bdi",
  "bdo",
  "big",
  "blockquote",
  "body",
  "br",
  "button",
  "canvas",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "datalist",
  "dd",
  "del",
  "details",
  "dfn",
  "dialog",
  "div",
  "dl",
  "dt",
  "em",
  "embed",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hgroup",
  "hr",
  "html",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "keygen",
  "label",
  "legend",
  "li",
  "link",
  "main",
  "map",
  "mark",
  "menu",
  "menuitem",
  "meta",
  "meter",
  "nav",
  "noindex",
  "noscript",
  "object",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "param",
  "picture",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "slot",
  "script",
  "section",
  "select",
  "small",
  "source",
  "span",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "table",
  "template",
  "tbody",
  "td",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "title",
  "tr",
  "track",
  "u",
  "ul",
  "var",
  "video",
  "wbr",
]);
