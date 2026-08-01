/**
 * The default host: the element a component gets when it has no @Host. It is a
 * custom element so that it is inert, can never collide with a real HTML tag,
 * and — unlike <div> — does not close an open <p> or otherwise steer the parser.
 *
 * It was a <template> until 2026-07-17. That is the natural "fragment" on the
 * client, but it cannot survive HTML: the parser moves a template's children
 * into its .content fragment, where nothing renders. Building them with
 * appendChild keeps them as real children (which is why the client worked), but
 * serializing dropped them and re-parsing would have made them inert — so SSR
 * silently emitted an empty <template> for every default-host component. No
 * serializer could fix that; the tag had to change. See BUGS.md.
 */
export const HOST_TAG = "RAMONDA-HOST";

/**
 * Keeps the default host layout-neutral: no box of its own, children lay out as
 * if the host were not there. That is what makes adding a component free.
 *
 * TODO(perf): this ships as an inline style attribute on every default host,
 * which costs ~26 bytes per component in SSR output (13KB on a 500-component
 * page). A single global rule — `ramonda-host { display: contents }` — would cut
 * the host to `<ramonda-host></ramonda-host>`. Not done yet because it makes the
 * markup depend on a stylesheet the app must ship in <head>: if it is late or
 * missing, every host falls back to `display: inline` and the layout breaks.
 * Worth doing once SSR is actually in use and the byte count is measurable.
 */
export const hostStyle = "display: contents";
export const svgNamespaceUri = "http://www.w3.org/2000/svg";

export const svgElements = new Set([
  "svg",
  "circle",
  "rect",
  "path",
  "g",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "text",
  "use",
  "defs",
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

export const DONE = 5;
export type DONE = 5;
export const TEXT_TYPE = 6;
export type TEXT_TYPE = 6;
export const COMPONENT_TYPE = 7;
export type COMPONENT_TYPE = 7;

export const HOST_META = Symbol("host:meta");
export const IS_SVG = Symbol("isSvg");
export const KEY_SYM = Symbol("key");
/** The `Ref` currently pointing at an element, so unmount can clear it. */
export const REF_SYM = Symbol("ref");
/** The style string last written to an element, for the attribute diff to compare against. */
export const STYLE_SYM = Symbol("style");

/** Brands the opaque object a built list is. See types/vdom.ts → ListNode. */
/** The component whose render() built this vnode / this DOM node. See core/origin.ts. */
export const ORIGIN_SYM = Symbol("origin");
export const IS_LIST = Symbol("isList");
/**
 * Wraps a value returned by `stable()`, so the props pass can resolve it against the
 * previous render's value for that key. Unwrapped before it ever reaches `this.props`.
 */
export const STABLE = Symbol("stable");
/** The prop names a hook declared with `@StableProps`, held on the class. */
export const STABLE_PROPS = Symbol("stableProps");
/**
 * DEV only. Marks a children array that `normalizeChildren` built — so a nested array
 * WITHOUT it came from the app (a `.map`, a `filter`, an array literal) rather than from
 * JSX or from `{this.props.children}` being passed down. See RMD023.
 */
export const OWN_CHILDREN = Symbol("ownChildren");
/**
 * Set by `flattenMixedArray` on a children array that contains at least one
 * list, so the diff can take the cheap path (a strict equality check) instead of
 * scanning every child of every element on every render to find out.
 */
export const HAS_LIST = Symbol("hasList");
/**
 * The child record, on elements that own at least one list. Holds this element's
 * children in render order, with each list collapsed to ONE entry — which is what
 * keeps a list's keys from being reachable by its siblings. Absent on every other
 * element, which keeps reading `childNodes` as it always has.
 */
export const CHILD_RECORD = Symbol("childRecord");
export const STATE_KEYS = Symbol("stateKeys");
/**
 * DEV-only, on a context Consumer: hands the inspector the context keys this consumer reads and
 * their current values.
 *
 * A consumer holds no state and no props — its values are accessors over the PROVIDER's signals —
 * so it appeared in devtools as an empty node, which is exactly the wrong answer for the hook whose
 * whole job is reading. It cannot be inspected by reading those accessors either: reading a key
 * SUBSCRIBES the consumer to it, so a panel that read all of them would silently widen what the
 * component re-renders on. The consumer therefore answers for itself, reporting the keys it has
 * already subscribed to and naming the rest as unread.
 */
export const CONTEXT_READS = Symbol("contextReads");
export const PERSIST_KEYS = Symbol("persistKeys");

// Attribute on a component's carrier element holding its serialized state blob.
export const STATE_ATTR = "data-ramonda-state";

/**
 * Marks every `<head>` element a `Head` hook manages.
 *
 * Shared by the hook (which writes it) and the server renderer (which collects
 * by it), so a static build can pull one page's head out of the document
 * without guessing which tags were the app's and which the shell's.
 */
export const HEAD_ATTR = "data-ramonda-head";

/**
 * Attribute on the ROOT element holding the per-request values the server chose to expose to
 * the client — one blob per page, not per component, because a request is one thing.
 *
 * Default is to expose NOTHING: a value only travels if its `requestKey` opted in with
 * `exposeToClient`. Cookies, headers and un-opted values never leave the server. See
 * hydration/requestContext.ts.
 */
export const REQUEST_ATTR = "data-ramonda-request";

export const attach = Symbol();
export const detach = Symbol();
