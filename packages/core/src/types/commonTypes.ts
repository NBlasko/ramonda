import type { RefTarget } from "../base/Ref";
import type { Runtime } from "../core/runtime";

export interface AnchorClickEvent extends Event {
  target: HTMLAnchorElement;
}

export type RenderableProps<P> = Readonly<P> & {
  readonly key?: string;
};

/**
 * The bag a component publishes on, and every descendant reads from.
 *
 * One object per component, made with `Object.create(parentContext)`. So a READ walks the
 * prototype chain and finds the nearest ancestor that published, and a WRITE lands as an OWN
 * property, which is what keeps a sibling from seeing it. Both halves are load-bearing: the chain
 * is the lookup, and own-ness is the scope.
 *
 * A hook publishes onto its OWNER's object, because a hook is handed the owning component's
 * runtime — which is why publishing belongs in `@created` rather than a constructor: by then the
 * component has its own object, and its children are rendered after, which is when they look.
 *
 * The keys belong to whoever publishes, and each publisher takes one nothing outside it can name:
 * `createContext` a fresh number from `createId()`, `Head` a module-private symbol. That is what
 * makes two publishers on one object safe, and it is the rule a third one keeps.
 *
 * The values are `unknown` because they have nothing in common — `createContext` publishes a
 * per-key signal channel, `Head` a node in the head tree. Whoever reads a key is whoever published
 * it, so the read is where the shape is named.
 */
export type Context = Record<string | number | symbol, unknown>;

// biome-ignore lint/complexity/noBannedTypes: Default Props
export type DefaultProps = {};

export type HookClassKind<T, R> = new (runtime: Runtime, options: R) => T;

type BaseElements = HTMLElement | SVGElement | SVGRect;

type ObservableEvents<T extends BaseElements> = {
  [K in keyof T as K extends `on${infer EventName}`
    ? `on${Capitalize<EventName>}`
    : // biome-ignore lint/complexity/noBannedTypes: This is how it works
      K]: T[K] extends Function ? T[K] : T[K];
};

/**
 * Names that typecheck and do nothing, refused here with the reason in the error.
 *
 * `ObservableEvents<T>` maps every property of the DOM interface, so a PROPERTY that is not an
 * attribute is accepted as one. An HTML attribute is written through `setAttribute`, which
 * lowercases the name — so `innerHTML` arrives as `innerhtml`, an attribute nothing reads. Measured
 * for every camelCase name a JSX author might reach for; these are the ones that came back dead.
 *
 * ## Why the type is a SENTENCE and not `never`
 *
 * `never` produces "Type 'string' is not assignable to type 'undefined'", which says something is
 * wrong and nothing about what to do. A string literal type puts the answer in the error itself:
 * TypeScript prints the expected type, so the expected type is the advice.
 *
 * ## Why these are refused rather than aliased
 *
 * `class` and `for` are aliased because they are RESERVED WORDS — that is the whole rule
 * `concepts/jsx` states, and it is complete. Nothing here is reserved: `http-equiv` and
 * `accept-charset` are writable exactly as HTML spells them, and `value` and `checked` are the
 * attributes React's `default*` pair stands in for. Aliasing them would turn a two-name exception
 * into a list that grows forever, and the framework's own rule is that the JSX is the DOM.
 */
interface RefusedNames {
  innerHTML: "Ramonda renders children — an `innerHTML` attribute reaches the DOM verbatim and nothing reads it";
  textContent: "put the text in the element's children — a `textContent` attribute does nothing";
}

/**
 * The same idea, for names that are dead on ONE element rather than on all of them.
 *
 * Written as separate types so each tag refuses only what is meaningless ON IT — a `<div>` has no
 * business being told about `http-equiv`, and an error naming an attribute the element does not
 * take is an error somebody has to decode before they can use it.
 */
export interface RefusedOnMeta {
  httpEquiv: "write `http-equiv` — an attribute with a hyphen is written exactly as HTML spells it, and `httpEquiv` reaches the DOM verbatim";
}

export interface RefusedOnForm {
  acceptCharset: "write `accept-charset` — an attribute with a hyphen is written exactly as HTML spells it, and `acceptCharset` reaches the DOM verbatim";
}

/**
 * React's uncontrolled-input pair, which this framework does not have.
 *
 * There is no controlled/uncontrolled distinction here: the `value` and `checked` attributes ARE
 * the initial state, and a render decides them like any other attribute.
 */
export interface RefusedOnFields {
  defaultValue: "write `value` — the attribute is the initial value, and `defaultValue` reaches the DOM verbatim";
  defaultChecked: "write `checked` — the attribute is the initial state, and `defaultChecked` reaches the DOM verbatim";
}

/**
 * The ways an element can be given a name, as a requirement rather than a suggestion.
 *
 * An image and a frame are the two things on a page that a reader who cannot see them has nothing
 * else to go on for: everything else can be worked out from what is inside it, and these have
 * nothing inside them. So the name is not a nicety, it is the content.
 *
 * ## Why a union rather than `alt: string`
 *
 * Because `alt` is one of four ways, and the checker already knows that: `unnamed-image` accepts
 * `alt`, `aria-label`, `aria-labelledby` or `title`, and `unnamed-frame` accepts the last three.
 * A type demanding `alt` alone would refuse `<img aria-label="…">` — markup the checker calls
 * correct — and a type and a rule disagreeing about the same line is worse than either being
 * slightly lax.
 *
 * `alt=""` satisfies this, which is right: it is the documented way to say "decoration, skip me",
 * and it is a decision somebody made rather than one they forgot.
 *
 * ## What it does to a spread, which is the point
 *
 * `<img {...rest} />` with an untyped bag is refused, because nothing about that bag says a name is
 * in it. That is exactly the case the checker cannot speak about — a spreading element is handed to
 * no rule at all — so the two halves cover each other rather than overlapping.
 *
 * A spread that carries a name in its TYPE passes, which is the shape a wrapper component should
 * have anyway.
 */
export type NamedImage = { alt: string } | { "aria-label": string } | { "aria-labelledby": string } | { title: string };

/** The same, for a frame: `alt` is not one of its attributes, so `title` leads. */
export type NamedFrame = { title: string } | { "aria-label": string } | { "aria-labelledby": string };

export type RamondaArgs<T extends BaseElements> = Partial<
  | ObservableEvents<T>
  | {
      [val: Lowercase<string>]: any;
      style: string | Record<string, string | undefined>;
      key: string | number;
      ref: RefTarget<T>;
    }
> &
  Partial<RefusedNames>;

export interface SVGArguments extends SVGGraphicsElement {
  width: string | number;
  height: string | number;
  fill: string;
  viewBox: string;
}

/**
 * SVG attribute names that genuinely contain capitals.
 *
 * **Ramonda writes SVG attribute names verbatim** — `setAttributeNS(null, name)`
 * with no translation — because the JSX is meant to be the DOM. So the name to
 * write is the one SVG defines: `stroke-width` and `fill-opacity` are dashed,
 * `viewBox` and `gradientUnits` are camelCase. React's `strokeWidth` is React's
 * invention and is correctly rejected here; it would also not work at runtime,
 * since SVG attribute names are case-sensitive and `strokeWidth` is not one.
 *
 * Dashed and all-lowercase names (`stroke-width`, `cx`, `d`, `points`) already
 * pass through the index signature in `RamondaArgs`. These do not, and for a
 * reason worth stating: each of them IS a property on the corresponding DOM
 * interface, typed as `SVGAnimatedEnumeration`, `SVGAnimatedLength` and friends.
 * The mapped `ObservableEvents` type therefore claims the name with the animated
 * type, and a plain `gradientUnits="userSpaceOnUse"` fails to assign. Declaring
 * them here as strings gives the literal a branch it can match.
 */
export interface SVGCamelCaseAttributes {
  // <svg>
  viewBox: string;
  preserveAspectRatio: string;
  zoomAndPan: string;
  baseProfile: string;
  // gradients
  gradientUnits: string;
  gradientTransform: string;
  spreadMethod: string;
  // patterns
  patternUnits: string;
  patternContentUnits: string;
  patternTransform: string;
  // clip, mask, filter
  clipPathUnits: string;
  maskUnits: string;
  maskContentUnits: string;
  filterUnits: string;
  primitiveUnits: string;
  // markers
  markerUnits: string;
  markerWidth: string | number;
  markerHeight: string | number;
  refX: string | number;
  refY: string | number;
  // text
  startOffset: string | number;
  textLength: string | number;
  lengthAdjust: string;
  pathLength: string | number;
  // filter primitives
  baseFrequency: string | number;
  numOctaves: string | number;
  stitchTiles: string;
  stdDeviation: string | number;
  surfaceScale: string | number;
  specularConstant: string | number;
  specularExponent: string | number;
  diffuseConstant: string | number;
  kernelMatrix: string;
  kernelUnitLength: string | number;
  edgeMode: string;
  xChannelSelector: string;
  yChannelSelector: string;
  tableValues: string;
  limitingConeAngle: string | number;
  pointsAtX: string | number;
  pointsAtY: string | number;
  pointsAtZ: string | number;
  targetX: string | number;
  targetY: string | number;
  // animation
  attributeName: string;
  attributeType: string;
  repeatCount: string | number;
  repeatDur: string;
  calcMode: string;
  keyTimes: string;
  keySplines: string;
  keyPoints: string;
  // conditional processing
  requiredExtensions: string;
  requiredFeatures: string;
  systemLanguage: string;
  externalResourcesRequired: string;
  // On an SVG element `className` is an SVGAnimatedString, so it needs the same
  // treatment as the above even though it is not SVG-specific.
  className: string;
}

/**
 * Props for an SVG intrinsic element: everything `RamondaArgs` allows, plus the
 * camelCase SVG attribute names above.
 *
 * `Omit` is what makes it work. Every name declared here is ALSO a property on
 * the DOM interface with an animated type, and an intersection of
 * `SVGAnimatedLength` with `string` is `never` — so the DOM's version has to be
 * removed before ours is added, rather than merged with it. What survives from
 * `ObservableEvents` is the event handlers, which is the part worth keeping.
 */
export type SVGArgs<T extends SVGElement> = Partial<
  SVGCamelCaseAttributes & {
    [attribute: Lowercase<string>]: unknown;
    style: string | Record<string, string | undefined>;
    key: string | number;
    ref: RefTarget<T>;
  } & Omit<ObservableEvents<T>, keyof SVGCamelCaseAttributes | Lowercase<string>>
>;

export interface RamondaEvent<T extends EventTarget | null = any> extends Event {
  target: T;
}

export interface HostMeta {
  /**
   * Tag of the component's host (carrier) element, e.g. "DIV". Default:
   * RAMONDA-HOST. Undefined when the tag comes from props — see `tagFromProps`.
   * The two are mutually exclusive; `@Host` sets exactly one.
   */
  tag?: string;
  /**
   * Resolves the host tag from the component's props, for a component whose
   * caller chooses the element: `@Host((p: CardProps) => p.as ?? "div")`.
   *
   * **Must be pure.** It is called while the diff decides whether an existing
   * DOM node can be reused, as well as when the component is built, so it runs
   * more than once and must not depend on anything but the props it is given.
   */
  tagFromProps?: (props: Record<string, unknown>) => string;
  /** Reactive attributes applied to the host element; runs on every render. */
  props?: (self: unknown) => Record<string, unknown>;
}
