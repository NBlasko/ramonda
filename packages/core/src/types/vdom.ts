import type { Context, DefaultProps, RenderableProps } from "./commonTypes";
import type { COMPONENT_TYPE, TEXT_TYPE } from "../helpers/constants";
import { IS_SVG, KEY_SYM, SLOT_SYM, IS_LIST, CHILD_RECORD, ORIGIN_SYM, STYLE_SYM, REF_SYM } from "../helpers/constants";

import type { COMPONENT_RUNTIME, ComponentRuntime, INTERNAL_HOOKS, GLOBAL_RUNTIME, Runtime } from "../core/runtime";
import type { RenderEnv } from "../core/renderEnv";
// Re-exported as public API (index.ts pulls it from here — a public folder — so
// the internal-folders rule stays satisfied). It is the argument type for the
// lifecycle decorators.
export type { RenderEnv };

interface EnhancedElement {
  _componentInstance?: BaseComponent<unknown>;
  _componentDefinition?: ComponentClassKind;
  _listeners?: Record<string, any>;
  value?: any;
  [IS_SVG]?: boolean;
  [KEY_SYM]?: any;
  /** The JSX child slot this node was built for. See SLOT_SYM. */
  [SLOT_SYM]?: number;
  [CHILD_RECORD]?: RecordEntry[];
  [ORIGIN_SYM]?: number;
  [STYLE_SYM]?: string;
  [REF_SYM]?: { current: unknown; setCurrent(current: unknown): void };
}

/**
 * What a built list is: **not** an array, on purpose.
 *
 * An array invites `slice`, `filter`, `map` and spread — and every one of those
 * silently desynchronizes the list from its record. The record would still claim
 * 10 nodes while 8 are on screen, and the next update would reorder against a
 * description of a DOM that does not exist. That is worse than the bug it
 * replaces, because today's diff at least reads the real DOM.
 *
 * So the type has no array methods at all: `nodes.slice(0, 5)` is a compile
 * error, and in plain JS it is an immediate TypeError rather than a quiet
 * fallback. Slice the DATA instead — `each: this.items.slice(0, 5)` — and the
 * list stays the authority on what it owns.
 */
export interface ListNode {
  readonly [IS_LIST]: true;
  /**
   * Identifies this same list across renders, and nothing else about it.
   *
   * Either an **origin-and-position string** (`"7:g0"`) — the component whose
   * render built it, plus the child slot it occupies — or `undefined` on a
   * `list()` descriptor that `normalizeChildren` has not stamped yet. Both
   * halves are needed; `regionOwner` in `vdom/h.ts` has the measurement.
   */
  readonly owner: unknown;
  readonly vnodes: VNode[];
  /**
   * Per item: true when its vnode is the very object from last render and none
   * of the signals it read have changed. The diff may then keep the existing DOM
   * node and skip walking into it — the subtree cannot have gone stale.
   */
  readonly clean: boolean[];
}

/**
 * A list, as it sits in its parent's record: one entry, holding the DOM nodes it
 * owns in order. The parent's match pass never looks inside, so a sibling — or a
 * caller's children, or a second list — cannot reach these nodes by key.
 */
export interface ListRegion {
  readonly owner: unknown;
  /**
   * The list's state, for a region built from a `list()` descriptor.
   *
   * A plain function has nowhere to put this, so it rides on the record entry
   * instead — per parent and per position for free, and released with the
   * region by `disposeRegions`. Typed loosely so `types/` need not import the
   * engine.
   */
  engine?: { dispose(): void };
  /**
   * This region's children, in order, with any list INSIDE it kept as its own
   * entry. Regions nest, so a list inside a slot inside a list is reconciled by
   * the same rules at every depth.
   */
  entries: RecordEntry[];
  /**
   * The `ListNode` that produced these nodes. The engine hands back the very
   * same object when nothing about the list changed, so identity here is the
   * signal that the whole region can be left alone without looking at an item.
   */
  source: ListNode;
}

/** One entry of a parent's child record: a plain node, or a whole list. */
export type RecordEntry = EnhancedChildNode | ListRegion;

export type LifecycleEnv = "client" | "server" | "shared";

export interface LifecycleEntry {
  id: number;
  // Receives the concrete render side ("client" | "server") when it fires, so a
  // @created/@mounted/@destroyed method can branch on where it is running. A method
  // that declares no parameter still satisfies this (fewer params is assignable).
  cb: (env: RenderEnv) => void;
  env: LifecycleEnv;
}

export interface WatchPropEntry {
  id: number;
  /**
   * The selectors this entry watches, each picking a (possibly deeply nested) value out of props —
   * `p => p.foo[5].bar`. One application of `@watchProp` makes one entry, however many it was given.
   *
   * A LIST rather than one, because "run this when any of these changes" is otherwise unwritable: the
   * only way to say it was to stack the decorator, which makes a separate entry per selector and
   * therefore calls the method once per CHANGED prop — twice when two moved in the same update. And
   * selecting a tuple from a single selector does not work either: comparison is `Object.is`, so a
   * fresh array is never equal and the method fires on every props change, with `previous` and `next`
   * holding the same contents. Measured, both.
   */
  selectors: readonly ((props: unknown) => unknown)[];
  /** The decorated method; receives the new and the old values, positionally, one per selector. */
  cb: (next: readonly unknown[], previous: readonly unknown[]) => void;
  /** Each selector's last seen value, seeded at mount without firing the callback. */
  lastValues: unknown[];
  /**
   * WHOSE props this entry watches — the component or the hook the decorator was
   * put on.
   *
   * A hook shares its owner's runtime, so every `@watchProp` in a tree of hooks
   * lands in one list; without this, running that list means guessing, and the
   * guess used to be "the component's props" for all of them. A hook's selector
   * was then handed a bag it has no relationship to: `p => p.userId` read the
   * OWNER's `userId`, silently, and a hook whose own prop changed never fired.
   * See `readWatchedProps` in helpers/watchProps.ts.
   */
  owner: object;
}

export interface EnhancedHTMLNode extends HTMLElement, EnhancedElement {}
export interface EnhancedSVGElement extends SVGElement, EnhancedElement {}

export type ComponentProps = Record<string, any>;

export interface EnhancedChildNode extends ChildNode, EnhancedElement {
  getAttribute?: (val: string) => any;
}

export interface EnhancedTextNode extends Text, EnhancedElement {
  getAttribute?: (val: string) => any;
}

export type EnhancedNode = EnhancedHTMLNode | EnhancedTextNode;
export type MaybeEnhancedNode = EnhancedNode | undefined;

export interface ComponentClassKind<P extends ComponentProps = DefaultProps> {
  new (props: P, context: Context): BaseComponent<P>;
  readonly __isComponent: true;
}

export type ComponentKind<P extends ComponentProps = DefaultProps> = string | ComponentClassKind<P>;

/**
 * A function found in the tag position. Not a supported kind of component —
 * `h` only accepts this to report RMD011 and keep the page alive. It is typed
 * so the reporting path does not need a cast; see JSX.ElementType in global.ts
 * for why TypeScript rejects it at the call site.
 */
export type UnsupportedTagFn = (props: never) => RamondaNode;

export type ComponentChild = VNode | string;

export type VNodeString = {
  type: TEXT_TYPE;
  name: string;
  attributes: Record<string, any> & { [IS_SVG]?: boolean };
  children: unknown[];
  [ORIGIN_SYM]?: number;
};

export type VNodeComponent = {
  type: COMPONENT_TYPE;
  name: ComponentClassKind;
  attributes: Record<string, any>;
  [ORIGIN_SYM]?: number;
};

export type VNode = VNodeString | VNodeComponent;

export type MaybeComponent = BaseComponent | undefined;

type RamondaAtom = VNode | ListNode | string | undefined | null | boolean | number;
/**
 * Anything that may appear as a child — including a whole list.
 *
 * `render()` may return one too: the host element always wraps the output, so a
 * bare `return this.rows.nodes` still produces exactly one element. 1-1 holds.
 */
export type RamondaNode = RamondaAtom | RamondaAtom[];

export declare class BaseComponent<P = DefaultProps> {
  public static readonly __isComponent = true;
  public [GLOBAL_RUNTIME]: Runtime;
  public [COMPONENT_RUNTIME]: ComponentRuntime;

  public [INTERNAL_HOOKS]?: (() => void)[];

  public props: RenderableProps<P>;

  public render(): RamondaNode;
}
