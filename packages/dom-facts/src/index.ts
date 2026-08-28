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

/**
 * State an element keeps in a PROPERTY, with no attribute of that name to write it in.
 *
 * Written as an attribute, each of these puts a word in the document that nothing reads, and the
 * element goes on holding whatever it held before. Measured: a served `<textarea value="hello">`
 * parses back with `.value` of `""` — an EMPTY field until the bundle arrives — and
 * `indeterminate="true"` sat in the markup beside a checkbox showing plainly unchecked.
 *
 * They are worth a table rather than a guess because each one looks like an attribute and is not:
 * `indeterminate` reads as a boolean attribute and there is none, and `volume` sits beside `width`
 * and `height`, which ARE attributes.
 *
 * **Spelled as the PROPERTY, and matched exactly.** These names have no HTML spelling to follow —
 * there is no `playbackrate` content attribute to be the lower-case form OF — so the only spelling
 * they have is the one the DOM gives them, and that is what an author writes. Lower-casing the name
 * before the lookup made the two disagree: `playbackrate={2}` matched the table and then wrote
 * nothing at all, because `"playbackrate" in video` is false. A silent no-op, and it was the
 * spelling the types encourage. A misspelled property is an author's mistake and belongs to
 * `@ramonda/check`, which reports it at the line that wrote it.
 *
 * Keyed by tag for that reason, and by tag ONLY — a name absent from every element belongs in
 * `@ramonda/check`'s dead-name list instead, where it is reported at the line that wrote it rather
 * than dropped where nobody can see the drop.
 *
 * `<select>` and `<textarea>` belong to the family and are deliberately NOT here: both tags are
 * refused by the types, and `Select` and `TextArea` consume the value before the element is built,
 * so an entry for either could never run. A table of facts nothing consults is a table that drifts.
 *
 * Both packages need the same list. `@ramonda/core` writes the property instead; `@ramonda/check`
 * will report the same names where they are typed, which is the better place of the two.
 */
const ABSENT: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["INPUT", new Set(["indeterminate"])],
  // A media element's playback state. `muted` is NOT here: it has a real attribute, which carries
  // the default muted state into a served page, so it is written as well as set.
  ["VIDEO", new Set(["volume", "playbackRate", "currentTime"])],
  ["AUDIO", new Set(["volume", "playbackRate", "currentTime"])],
]);

/**
 * Every property-only name this element has.
 *
 * The table is reached through here and nowhere else, so there is one place that knows how it is
 * keyed. `tag` is a `nodeName`, which HTML already gives in upper case, and names are compared as
 * WRITTEN — see above for why neither is folded.
 *
 * This is the shape `@ramonda/check` needs: somebody wrote `playbackrate`, there is no such thing,
 * and answering "what did they mean" takes the names themselves. A checker keeping its own copy of
 * them would be the second list this table exists to prevent.
 */
export function propertyOnlyNames(tag: string): ReadonlySet<string> | undefined {
  return ABSENT.get(tag);
}

/**
 * Whether this element keeps the named state in a property alone — the one question
 * `@ramonda/core` has, since it either writes the property or it does not.
 *
 * Built on the reader above rather than reaching for the table again. Two accessors are right here,
 * because they answer different questions and their callers read better for it; two ways INTO the
 * table would not be.
 */
export function keptInAProperty(tag: string, attribute: string): boolean {
  return propertyOnlyNames(tag)?.has(attribute) === true;
}
