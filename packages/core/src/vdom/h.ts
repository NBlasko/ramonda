import { createRamonda } from "../vdom/CreateRamonda";
import type { ComponentChild, ComponentKind, ComponentClassKind, UnsupportedTagFn, RamondaNode } from "../types/vdom";
import { svgElements, COMPONENT_TYPE, TEXT_TYPE, IS_SVG, HOST_TAG, IS_LIST, HAS_LIST } from "../helpers/constants";
import { isArray } from "../helpers/utils";
import { ramondaLog } from "../debug/logger";
import { currentOrigin } from "../core/origin";
import { reportFunctionTag } from "../debug/jsxRules";

/**
 * Normalizes one element's children — and, unlike a plain flatten, **keeps a
 * nested array as one child**.
 *
 * Splicing an array into its parent's children destroys the only structure JSX
 * gave us. Two `.map()` calls side by side became one flat run of siblings
 * sharing a key index, so their keys collided exactly the way two lists did;
 * and a caller's array merged into the component's own children, so the
 * component's chrome could be claimed as part of it.
 *
 * React does not have this problem because it never flattens: a nested array is
 * reconciled as its own unit with its own key space. This does the same, reusing
 * the region machinery the child record already has.
 *
 * A group is identified by its ORDINAL among the arrays in these children, which
 * is stable because JSX structure is, and the ORIGIN pins it to the component
 * that wrote it — see `regionOwner` for why position alone was not enough.)
 *
 * Grouping is recursive: an array inside an array is its own group again, and
 * a list mixed with other children keeps its own region. The diff walks
 * regions recursively (`reconcileEntries`), so there is no depth limit.
 */
function normalizeChildren(arr: unknown[]): unknown[] {
  const result: unknown[] = [];
  let hasList = false;

  for (let index = 0; index < arr.length; index++) {
    const el = arr[index];
    if (isArray(el)) {
      const inner = normalizeChildren(el);

      const owner = regionOwner(index);

      if (inner.length === 0) continue;

      // Already exactly one group or list — `{this.props.children}` where the
      // caller passed a list. Wrapping it again would add a pointless level.
      if (inner.length === 1 && isListLike(inner[0])) {
        result.push(inner[0]);
        hasList = true;
        continue;
      }

      result.push({
        [IS_LIST]: true,
        owner,
        vnodes: inner,
        clean: [],
      });
      hasList = true;
    } else if (el !== null && typeof el === "object" && (el as { [IS_LIST]?: true })[IS_LIST]) {
      // A list stays ONE child. Splicing its vnodes in here is exactly what let
      // two lists share the parent's key index and swap each other's nodes
      // (BUGS.md — "Two `For` instances in one parent mint the same ids").
      //
      // A `list()` descriptor arrives with no owner, because a plain function
      // cannot know where it was called. It gets the SAME position identity an
      // array group gets, and for the same documented reason: positions are
      // stable for a piece of JSX, call order is not — `{cond && list(a)}` stops
      // being the first call the moment `cond` is false, and the region (with
      // its state) would go to the wrong list.
      const listChild = el as { owner?: unknown };
      if (listChild.owner === undefined) listChild.owner = regionOwner(index);

      result.push(el);
      hasList = true;
    } else if (el !== null && typeof el === "object") {
      // A valid vnode is one of exactly two shapes (TEXT_TYPE or COMPONENT_TYPE).
      // @ts-ignore
      const isVNode = el.type === TEXT_TYPE || el.type === COMPONENT_TYPE;

      if (isVNode) {
        result.push(el);
      } else if (__DEV__) {
        ramondaLog("error", "Invalid object among JSX children. Dropped from the render.", el);
      }

      // Dropped in DEV and in production alike: an object that is not a vnode
      // has nothing the diff can do with it, and letting it into the children
      // array would fault somewhere later, far from the JSX that produced it.
    } else {
      // Strings, numbers and other primitives pass through untouched.
      result.push(el);
    }
  }

  // O(1) signal for the diff. Without it, finding out whether an element owns a
  // list would mean scanning its children on every render, for every element.
  if (hasList) (result as { [HAS_LIST]?: boolean })[HAS_LIST] = true;

  return result;
}

/**
 * The identity a list or a child group is found by next render.
 *
 * Two halves, and both are load-bearing.
 *
 * **The CHILD POSITION**, not a count of the groups before it. JSX passes every
 * expression slot as an argument — `{cond && <li/>}` arrives as `false` rather
 * than vanishing — so positions are stable for a given piece of JSX, and
 * counting is not: an empty array that later fills up used to shift every group
 * after it by one, handing its region (and its state) to the wrong list.
 * Measured "l1#10 | r1#0" where "l1#0 | r1#10" was meant.
 *
 * **The ORIGIN** — which component's render built this vnode. Position alone is
 * only unique within one component's JSX, and children cross that boundary: a
 * component that renders its own list and then `{this.props.children}` puts the
 * caller's list into the SAME element, and both were written at index 0 of their
 * own JSX. Measured with position alone: the host's two rows rendered twice and
 * the caller's row lost its state — "own1#0 | own2#0 | own1#0 | own2#0 | sent2#0"
 * where "own1#0 | own2#0 | sent2#8" was meant. `For` never had this problem
 * because its identity was the hook instance, which is per component already.
 */
function regionOwner(index: number): string {
  return `${currentOrigin.id}:g${index}`;
}

function isListLike(value: unknown): boolean {
  return value !== null && typeof value === "object" && (value as { [IS_LIST]?: true })[IS_LIST] === true;
}

/**
 * Builds a vnode from a JSX tag. Exactly two kinds belong there: an intrinsic
 * tag, and a class component — each of which becomes exactly ONE element. That
 * one-to-one rule is what makes a Ramonda tree readable: the JSX is the DOM.
 *
 * A function is accepted only so it can be reported (RMD011) instead of quietly
 * behaving like a component that has no element. TypeScript already rejects it
 * at the call site — see JSX.ElementType in global.ts.
 */
/**
 * A component class with its own props, called directly rather than through JSX.
 *
 * JSX does not need this — TypeScript checks a JSX element against the class's
 * own constructor, so `<Card title="a" />` is already typed. Calling `h` by hand
 * is not checked that way, and the general signature below can only say
 * `ComponentClassKind<DefaultProps>`, which no component with required props is
 * assignable to (the constructor parameter is contravariant).
 *
 * Without this overload, building a vnode programmatically — a route table
 * generated from a content directory, a registry of demos, anything where the
 * tag is a value rather than syntax — forced a cast at every call site, and a
 * cast is exactly what stops the props from being checked at all.
 */
export function h<P extends Record<string, any>>(
  name: ComponentClassKind<P>,
  attributes: P & { key?: string | number },
  ...children: ComponentChild[]
): RamondaNode;
export function h<T extends Record<string, any> | { key?: string } | null>(
  name: ComponentKind | UnsupportedTagFn,
  rawAttributes: T,
  ...children: ComponentChild[]
): RamondaNode;
export function h(
  name: ComponentKind | UnsupportedTagFn,
  rawAttributes: Record<string, any> | null,
  ...children: ComponentChild[]
): RamondaNode {
  const parsedChildren = normalizeChildren(children);

  const attributes: Record<string, any> = rawAttributes ?? {};

  if (typeof name === "string") {
    if (svgElements.has(name)) {
      const svgAttributes: Record<string, any> & { [IS_SVG]?: boolean } = attributes;
      svgAttributes[IS_SVG] = true;
      return createRamonda(name, svgAttributes, parsedChildren);
    }
    const upperCaseName = name.toUpperCase();
    return createRamonda(upperCaseName, attributes, parsedChildren);
  }

  // 2. Classes (components) — each becomes exactly one element.
  if ((name as ComponentClassKind).__isComponent) {
    return createRamonda(name as ComponentClassKind, attributes, parsedChildren);
  }

  // 3. A function in tag position — not a supported kind of component.
  //
  // A tag that is not an element defeats the reason the 1-1 rule exists: that
  // the DOM is readable off the JSX. Report it (RMD011) and point at the real
  // answer — a Hook for state/lifecycle without an element, or `{fn()}` if
  // vnodes were all that was wanted.
  //
  // Call it anyway: TS already rejects this at the call site, so if it got here
  // the build has no types, and crashing the page would help nobody.
  if (typeof name === "function") {
    try {
      if (__DEV__) reportFunctionTag(name.name);
      return (name as UnsupportedTagFn)(attributes as never);
    } catch (e) {
      if (__DEV__) {
        console.error(
          "Ramonda Critical: a function in tag position threw while rendering.",
          "\nFunction:",
          name,
          "\nError:",
          e,
        );
      }
      // In production, return an empty host rather than take the whole site
      // down. It must be HOST_TAG and not "template": the name goes into the
      // vnode verbatim and the diff compares it against nodeName (always
      // uppercase), so a lowercase tag would never match and would mint a new
      // node on every render.
      return createRamonda(HOST_TAG, {}, []);
    }
  }
  // Nothing matched: not a string, not a component class, not a function.
  if (__DEV__) {
    console.error("Ramonda Error: unknown element type in h():", name);
  }

  return createRamonda(HOST_TAG, {}, []);
}
