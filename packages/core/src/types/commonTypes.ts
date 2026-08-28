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

/**
 * The element's own properties, as attributes — everything except the `on…` half.
 *
 * Handlers used to come from here too, renamed to `on${Capitalize<name>}`, and that was measured to
 * do something other than it looked like: the DOM's event types are single lowercase tokens, so
 * capitalising the first letter produces `onMouseenter`, `onKeydown`, `onDblclick`. The natural
 * spellings were hard errors and the accepted ones were unguessable — unnoticed for as long as it
 * was because every event this repository writes is ONE word, where `onclick` capitalises correctly.
 *
 * They come from the DOM's event MAP now (see {@link EventHandlers}), which is a better source in
 * three ways: nothing has to be capitalised, it is the authoritative list of what
 * `addEventListener` accepts, and it holds the five events with no `on…` property at all.
 */
type DomProperties<T extends BaseElements> = {
  // biome-ignore lint/complexity/noBannedTypes: This is how it works
  [K in keyof T as K extends `on${string}` ? never : K]: T[K] extends Function ? T[K] : T[K];
};

/**
 * Every event `addEventListener` accepts on an element, spelled the way the DOM spells it.
 *
 * `onclick`, `onmouseenter`, `onfocusin` — the event's own name with `on` in front, which is what
 * the runtime does in reverse (`Attribute.ts`, `eventTypeOf`). One spelling, derived, no list.
 *
 * The media map is here as well because `<video>` and `<audio>` add two of their own; everything
 * else a media element fires is already on `GlobalEventHandlers`.
 */
type EventHandlers = {
  [K in keyof (HTMLElementEventMap & HTMLMediaElementEventMap) as `on${K}`]: (
    ev: (HTMLElementEventMap & HTMLMediaElementEventMap)[K],
  ) => void;
};

/**
 * A listener for an event the first spelling cannot reach.
 *
 * `on` + a lowercase name covers every STANDARD event, because all 107 of them are single lowercase
 * tokens. It cannot reach a custom event with a dash or a capital — `my-event`, the convention a web
 * component dispatches by — and the attempt used to be silent: `on-my-event` typechecked and
 * attached a listener for `-my-event`, which nothing ever fires.
 *
 * So the rest of the name is handed through untouched: `<x-thing on:my-event={…} />`. `Event` is
 * the honest type — a custom event's detail is the app's own, and this cannot know it.
 */
type VerbatimEvents = {
  [name: `on:${string}`]: (ev: Event) => void;
};

/**
 * The spelling this used to accept, refused with the one that replaced it.
 *
 * Generated from the same map, so it cannot fall out of step. One entry per event, and it is
 * exactly the form the old mapping produced: `onClick` for the single-word events, which is also
 * what somebody used to another JSX dialect types, and `onMouseenter` for the rest, which is what
 * anybody who wrote against the old types has in their source. Both land on the same sentence, and
 * the sentence names the spelling to use.
 *
 * It cannot cover `onMouseEnter`, because nothing can produce that string from `"mouseenter"` —
 * that one is an ordinary "not assignable", which is as much as a type can say about a name it
 * cannot spell.
 */
type RefusedEventCasing = {
  [K in keyof HTMLElementEventMap as `on${Capitalize<K>}`]: "write the event name in lowercase, as the DOM spells it — `onclick`, `onmouseenter`";
};

/**
 * Names that typecheck and do nothing, refused here with the reason in the error.
 *
 * `DomProperties<T>` maps every property of the DOM interface, so a PROPERTY that is not an
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
 * Kept SHORT for the same reason. The error is read in an editor's tooltip and on one terminal
 * line, which is the most cramped place any of this project's prose appears — the first drafts ran
 * to 144 characters and arrived as a wall. What a reader needs is the name to write.
 *
 * ## Why these are refused rather than aliased
 *
 * `class` and `for` are aliased because they are RESERVED WORDS — that is the whole rule
 * `concepts/jsx` states, and it is complete. Nothing here is reserved: `http-equiv` and
 * `accept-charset` are writable exactly as HTML spells them, and `value` and `checked` are the
 * attributes a `default*` spelling would be standing in for. Aliasing them would turn a two-name
 * exception into a list that grows forever, and the framework's own rule is that the JSX is the DOM.
 */
interface RefusedNames {
  innerHTML: "write the markup as children — `innerHTML` is not an attribute";
  textContent: "write the text as children — `textContent` is not an attribute";
}

/**
 * The same idea, for names that are dead on ONE element rather than on all of them.
 *
 * Written as separate types so each tag refuses only what is meaningless ON IT — a `<div>` has no
 * business being told about `http-equiv`, and an error naming an attribute the element does not
 * take is an error somebody has to decode before they can use it.
 */
export interface RefusedOnMeta {
  httpEquiv: "write `http-equiv`, with the hyphen, as HTML spells it";
}

export interface RefusedOnForm {
  acceptCharset: "write `accept-charset`, with the hyphen, as HTML spells it";
}

/**
 * The `defaultValue` / `defaultChecked` pair, which this framework does not have.
 *
 * There is no controlled/uncontrolled distinction here for them to mark: the `value` and `checked`
 * attributes ARE the initial state, and a render decides them like any other attribute.
 */
export interface RefusedOnFields {
  defaultValue: "write `value` — the attribute IS the initial value";
  defaultChecked: "write `checked` — the attribute IS the initial state";
}

/**
 * `selected` on an `<option>`, which `Select` overwrites on every render.
 *
 * The choice belongs to the select, not to the option, and `Select` applies it by walking EVERY
 * option and setting each one from its `value` — on and off, for all of them. So an option that
 * asked to be chosen is turned off again a moment later. The attribute is not competing with
 * `value` and losing sometimes; it does nothing, while being the one line on the page that looks
 * like it chooses.
 *
 * Refused here rather than left to `@ramonda/check` alone for the reason `<select>` itself is: the
 * error arrives at the call site, in the editor, before the page is ever run. The checker reports
 * it too, because a type is a defence only while nobody casts it away — a `@ts-ignore`, a props bag
 * widened somewhere, a JavaScript file.
 */
export interface RefusedOnOption {
  selected: "the choice belongs to the select — write <Select value={x}>, which sets this on every option";
}

/**
 * The two tags whose meaning the framework cannot leave to the author: `<select>` and `<textarea>`.
 *
 * Every other element says what it is with its own attributes. A select says it with its CHILDREN —
 * the choice is which option is chosen — and neither half of that can be written down honestly:
 *
 * - On the element, before its options exist, there is nothing yet to choose from.
 * - On an option, `selected` is a CLAIM. HTML settles competing claims by document order, and gives
 *   a select holding none the first option it is handed. So what the attribute means depends on the
 *   order the options reached the select, which is the diff's business — no author writes that order
 *   and none can see it.
 *
 * `<Select value={x}>` says it once, on the element that owns the choice, and settles it once the
 * options are in the element. `<option>` needs no counterpart: it has no choice to make, so it stays
 * an ordinary tag, in a `<datalist>` as much as in a select.
 *
 * A `<textarea>` is the same shape with a different answer. Its value is the element's TEXT and HTML
 * gives it no `value` attribute at all, so a served `<textarea value="hello">` reached the reader as
 * an EMPTY field. The value has to be written as a CHILD, which only something that renders the tag
 * can do — and it cannot be done from the attribute pass, which runs before the children and whose
 * text node the children pass then unmounts as a leftover.
 *
 * A required property, so writing either tag at all is the error and the property NAME is the
 * message. Unlike the other refusals in this file, which are `Partial` and bite only when somebody
 * writes the named attribute — here the tag itself is the mistake, so no spelling of it passes.
 */
export interface RefusedTextAreaTag {
  "write <TextArea value={x}> — a plain <textarea> cannot carry its value, because the value is the element's text": never;
}

export interface RefusedSelectTag {
  "write <Select value={x}> — a plain <select> cannot say which option is chosen, because the choice is its children": never;
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
 *
 * ## And why `alt={maybe}` is refused when `maybe` is `string | undefined`
 *
 * Because it is not proof. Measured: an attribute given `undefined` is not written at all — no
 * `alt`, not even an empty one — so a name that MIGHT be undefined is a name that might not be
 * there, and this type exists to say it is.
 *
 * `ramonda-check` is quiet about the same line, and the two are not in disagreement. The rule asks
 * whether an `alt` was WRITTEN, because it cannot evaluate an expression and reporting a maybe is
 * the one thing it may never do. The type can see the expression's type, so it asks the stronger
 * question. Permissive where nothing can be known, strict where something can — the same division
 * as with the spread above.
 *
 * The fix is to decide: `alt={caption ?? ""}` says "no caption, and that is deliberate", which is
 * exactly what an empty `alt` means.
 */
export type NamedImage = { alt: string } | { "aria-label": string } | { "aria-labelledby": string } | { title: string };

/** The same, for a frame: `alt` is not one of its attributes, so `title` leads. */
export type NamedFrame = { title: string } | { "aria-label": string } | { "aria-labelledby": string };

export type RamondaArgs<T extends BaseElements> = Partial<
  | DomProperties<T>
  | EventHandlers
  | VerbatimEvents
  | {
      [val: Lowercase<string>]: any;
      style: string | Record<string, string | undefined>;
      key: string | number;
      ref: RefTarget<T>;
    }
> &
  Partial<RefusedNames> &
  Partial<RefusedEventCasing>;

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
 * `viewBox` and `gradientUnits` are camelCase. There is no second spelling to learn
 * and nothing to translate: `strokeWidth` is not an SVG attribute name, so the types
 * reject it, and it would not work at runtime either — SVG names are case-sensitive.
 *
 * Dashed and all-lowercase names (`stroke-width`, `cx`, `d`, `points`) already
 * pass through the index signature in `RamondaArgs`. These do not, and for a
 * reason worth stating: each of them IS a property on the corresponding DOM
 * interface, typed as `SVGAnimatedEnumeration`, `SVGAnimatedLength` and friends.
 * The mapped `DomProperties` type therefore claims the name with the animated
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
 * `DomProperties` is everything that is not a handler; the handlers come from `EventHandlers`,
 * which is the same for every element.
 */
export type SVGArgs<T extends SVGElement> = Partial<
  SVGCamelCaseAttributes & {
    [attribute: Lowercase<string>]: unknown;
    style: string | Record<string, string | undefined>;
    key: string | number;
    ref: RefTarget<T>;
  } & Omit<DomProperties<T>, keyof SVGCamelCaseAttributes | Lowercase<string>> &
    EventHandlers &
    VerbatimEvents
>;

/**
 * An event, told which element the handler is ON — for the one line the DOM's own types cannot type.
 *
 * `e.currentTarget.value` does not compile, because `Event.currentTarget` is `EventTarget | null`
 * and an `EventTarget` has no `value`. So every handler that reads a field off its own element
 * opens with a cast, which is the type system being told to look away.
 *
 * ```tsx
 * <input onchange={(e: EventOn<HTMLInputElement>) => this.draft = e.currentTarget.value} />
 * <button onclick={(e: EventOn<HTMLButtonElement, PointerEvent>) => e.currentTarget.blur()} />
 * ```
 *
 * The event type is already right without this — `onclick` gives `PointerEvent` and `onkeydown` a
 * `KeyboardEvent`, from the DOM's own map — so the second argument is only for a handler that needs
 * both halves named at once.
 *
 * ## Why this is opt-in rather than the default
 *
 * The default would be to parameterise the whole handler map by the element, and it works: written
 * that way, `e.currentTarget.value` needs no annotation at all. It also costs. Measured on
 * `apps/docs` with `--extendedDiagnostics`, **type instantiations went from 244,875 to 346,688** —
 * and not as a fixed cost, because `packages/router` moved a third as far, so it scales with how
 * much JSX a codebase contains. That is a tax on every consumer's build in exchange for saving an
 * annotation on the handlers that read their own element.
 *
 * Narrowing it to the events people actually reach for does NOT help: restricting the intersection
 * to eight event names produced 346,688 instantiations, to the digit. TypeScript instantiates the
 * whole mapped type per element type whatever is inside it. There is no cheap version of that
 * shape, and this note exists so nobody measures it twice.
 *
 * ## `currentTarget`, and deliberately not `target`
 *
 * `currentTarget` is the element the listener is attached TO, which the framework knows because it
 * attached it — so there is a right answer here, which is what makes naming it worthwhile.
 *
 * **It is an annotation, not a proof.** A JSX handler prop is bivariant in its parameter — which is
 * what lets a narrower one stand at all — and the same bivariance accepts `EventOn<HTMLSelectElement>`
 * on an `<input>`. Nothing cross-checks the element against the tag. That is still better than the
 * `as HTMLInputElement` it replaces, which asserts exactly as much in more characters, but
 * `Listener.run` refused method syntax for letting this same bivariance LOOK like a check, so it is
 * said plainly here too. Pinned in `JsxTypeClaims.tsx` as `wrongElementIsNotCaught`.
 *
 * `target` is where the event ORIGINATED, and for anything that bubbles that is any descendant:
 * a click on a `<span>` inside a `<button>` has the span as its target. Narrowing it would be a
 * type that is wrong exactly when a reader most needs it to be right, which is why this does not,
 * and why `e.target` still answers `EventTarget | null`.
 */
export type EventOn<T extends EventTarget, E extends Event = Event> = E & { currentTarget: T };
