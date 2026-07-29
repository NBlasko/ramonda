import type { RefTarget } from "../base/Ref";
import type { Runtime } from "../core/runtime";
import type { State } from "../reactivity/State";

export interface AnchorClickEvent extends Event {
  target: HTMLAnchorElement;
}

export type RenderableProps<P> = Readonly<P> & {
  readonly key?: string;
};

export type Context = Record<string | number, State<any>>;

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

export type RamondaArgs<T extends BaseElements> = Partial<
  | ObservableEvents<T>
  | {
      [val: Lowercase<string>]: any;
      style: string | Record<string, string | undefined>;
      key: string | number;
      ref: RefTarget<T>;
    }
>;

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
