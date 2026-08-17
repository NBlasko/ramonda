import { createRamonda } from "../vdom/CreateRamonda";
import type { ComponentChild, ComponentKind, ComponentClassKind, UnsupportedTagFn, VNode } from "../types/vdom";
import { svgElements, IS_SVG, HOST_TAG, IS_LIST, HAS_LIST, OWN_CHILDREN } from "../helpers/constants";
import { isArray } from "../helpers/utils";
import { isListNode, isVNode } from "./guards";
import { diagnose } from "../debug/diagnostics";
import { currentOrigin } from "../core/origin";
import { renderingOwner } from "../debug/renderPhase";
import { reportFunctionTag, reportUnkeyedArrayChildren } from "../debug/jsxRules";

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
/**
 * Reports the children of an expression-built array that carry no key, together —
 * one diagnostic per kind rather than one per row.
 *
 * ## Why this changed
 *
 * It used to say "do not do this, use `list()`", and only for COMPONENTS, on the
 * reasoning that plain markup survives being matched by position because the diff
 * patches the text. That is true of the text and false of everything else on the
 * element: an `<input>` in a plain `<li>` holds a caret, a selection and whatever
 * the user typed, and those follow the node.
 *
 * A `.map()` is a perfectly good way to render a list, and the thing it needs is
 * the thing every framework asks for here — a key. So this asks for one, for any
 * element, and mentions `list()` as the faster shape rather than the required one.
 *
 * A single child is skipped: `{cond && <Row />}` and `{[<Row />]}` have no siblings
 * to be reordered against, so position identity cannot go wrong.
 */
function checkUnkeyedArrayChildren(children: unknown[]): void {
  if (children.length < 2) return;

  const names: string[] = [];
  for (const child of children) {
    // Only real elements. A nested array or a `list()` is its own region and is
    // matched as one child, so a key on it would be answering a question nobody
    // asked here.
    if (!isVNode(child)) continue;
    // One keyed child means the app is managing identity, and this does not
    // second-guess that.
    if (child.attributes?.key !== undefined) return;
    names.push(typeof child.name === "function" ? `<${child.name.name} />` : `<${String(child.name)}>`);
  }

  if (names.length > 0) reportUnkeyedArrayChildren(names);
}

/**
 * One entry out for every entry in, always — `result.length === arr.length`.
 *
 * That is what makes an index here mean "this piece of JSX", the identity both `regionOwner`
 * and `SLOT_SYM` are built on. Anything that renders nothing becomes `false` rather than
 * disappearing, because a disappearing entry renumbers every sibling after it.
 */
export function normalizeChildren(arr: unknown[], originId: number): unknown[] {
  const result: unknown[] = [];
  let hasList = false;

  for (let index = 0; index < arr.length; index++) {
    const el = arr[index];
    if (isArray(el)) {
      const inner = normalizeChildren(el, originId);

      // Built by an expression rather than by JSX or by `{this.props.children}` being
      // passed down. Only unkeyed components are reported, and only from here, because
      // structure is the only thing that can see this at all — see RMD023.
      if (__DEV__ && !(OWN_CHILDREN in el)) checkUnkeyedArrayChildren(inner);

      // An empty list still HOLDS ITS PLACE. Dropping it shortens the array, which moves
      // the slot of every sibling after it — and the slot is the identity the diff matches
      // on (SLOT_SYM), so an emptied list would cost its siblings their DOM nodes. `false`
      // is the same thing a `{cond && …}` hole leaves behind, and the diff already skips it.
      if (inner.length === 0) {
        result.push(false);
        continue;
      }

      // Already exactly one group or list — `{this.props.children}` where the
      // caller passed a list. Wrapping it again would add a pointless level.
      if (inner.length === 1 && isListNode(inner[0])) {
        result.push(inner[0]);
        hasList = true;
        continue;
      }

      // Minted here rather than above the two early returns: both discard it, so
      // computing it first allocated a string per passthrough and per emptied
      // group on every render, only to throw it away.
      result.push({
        [IS_LIST]: true,
        owner: regionOwner(index, originId),
        vnodes: inner,
        clean: [],
      });
      hasList = true;
    } else if (isListNode(el)) {
      // A list stays ONE child. Splicing its vnodes in here is exactly what let
      // two lists share the parent's key index and swap each other's nodes
      // ("two `For` instances in one parent mint the same ids").
      //
      // A `list()` descriptor arrives with no owner, because a plain function
      // cannot know where it was called. It gets the SAME position identity an
      // array group gets, and for the same documented reason: positions are
      // stable for a piece of JSX, call order is not — `{cond && list(a)}` stops
      // being the first call the moment `cond` is false, and the region (with
      // its state) would go to the wrong list.
      // The cast defeats `readonly` and nothing else — `owner` is declared
      // immutable because nobody but this line may stamp it, and this is that
      // line. The READ beside it is typed.
      if (el.owner === undefined) (el as { owner: unknown }).owner = regionOwner(index, originId);

      result.push(el);
      hasList = true;
    } else if (el !== null && typeof el === "object") {
      // A valid vnode is one of exactly two shapes (TEXT_TYPE or COMPONENT_TYPE) —
      // which is what `isVNode` asks, so the `@ts-ignore` this line carried is gone.
      if (isVNode(el)) {
        result.push(el);
      } else {
        if (__DEV__) {
          // The component and the kind, so two of these in two components are two reports. Keyed on
          // the kind alone, `[object Object]` is every plain object anyone ever renders by mistake:
          // the first would be reported and the rest silently deduped against it.
          const kind = Object.prototype.toString.call(el);
          const owner = renderingOwner();
          diagnose("RMD037", `${owner}:${kind}`, `A ${kind} among the children of ${owner}, dropped from the render.`, {
            kind,
            owner,
          });
        }
        // Replaced by a hole rather than removed, so the slot survives — see the empty
        // list above. What it renders is nothing either way.
        result.push(false);
      }

      // Dropped in DEV and in production alike: an object that is not a vnode
      // has nothing the diff can do with it, and letting it into the children
      // array would fault somewhere later, far from the JSX that produced it.
    } else if (typeof el === "function") {
      /**
       * `{Panel}` where `<Panel />` was meant.
       *
       * It renders nothing and, until this, said nothing: the check above looks for an OBJECT among
       * children, and a class is a function, so it fell through here with the primitives and was
       * dropped in silence. Measured before the code was added — the page simply comes up without
       * the component.
       *
       * Only reported, not replaced: a function child already renders nothing, so pushing a hole
       * instead would change no page and this is the report that was missing.
       */
      if (__DEV__) {
        const owner = renderingOwner();
        const named = (el as { name?: string }).name || "a component";
        diagnose("RMD052", `${owner}:${named}`, `\`{${named}}\` among the children of ${owner} renders nothing.`, {
          named,
          owner,
        });
      }
      result.push(el);
    } else {
      // Strings, numbers and other primitives pass through untouched.
      result.push(el);
    }
  }

  // O(1) signal for the diff. Without it, finding out whether an element owns a
  // list would mean scanning its children on every render, for every element.
  if (hasList) (result as { [HAS_LIST]?: boolean })[HAS_LIST] = true;

  // Brands this array as the framework's own, so `{this.props.children}` — which is this
  // very array, handed one level down — is not mistaken for a mapped one.
  if (__DEV__) (result as { [OWN_CHILDREN]?: boolean })[OWN_CHILDREN] = true;

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
 *
 * Passed in rather than read from `currentOrigin`, because children are also
 * normalized OUTSIDE a render: a `ChildrenRegion` — the children a hook consumes
 * — has no render to be the origin of, and supplies its own id. Every id comes
 * from the one process-wide counter, so a region's can never be a component's.
 */
function regionOwner(index: number, originId: number): string {
  return `${originId}:g${index}`;
}

/**
 * Builds a vnode from a JSX tag. Exactly two kinds belong there: an intrinsic
 * tag, and a class component — each of which becomes exactly ONE element. That
 * one-to-one rule is what makes a Ramonda tree readable: the JSX is the DOM.
 *
 * A function is accepted only so it can be reported (RMD011) instead of quietly
 * behaving like a component that has no element. TypeScript already rejects it
 * at the call site — see JSX.ElementType in global.ts.
 *
 * The return is one `VNode`, which is the 1-1 rule stated in the type: every tag
 * the types accept builds exactly one element. Declaring the wider `RamondaNode`
 * described only the unreachable branch below, and made callers that build vnodes
 * by hand — a generated route table, a table cell — cast the result back.
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
export function __h<P extends Record<string, any>>(
  name: ComponentClassKind<P>,
  attributes: P & { key?: string | number },
  ...children: ComponentChild[]
): VNode;
export function __h<T extends Record<string, any> | { key?: string } | null>(
  name: ComponentKind | UnsupportedTagFn,
  rawAttributes: T,
  ...children: ComponentChild[]
): VNode;
export function __h(
  name: ComponentKind | UnsupportedTagFn,
  rawAttributes: Record<string, any> | null,
  ...children: ComponentChild[]
): VNode {
  const parsedChildren = normalizeChildren(children, currentOrigin.id);

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
  //
  // The nullish check is load-bearing, not defensive. `<Thing />` where the import failed arrives
  // here as `undefined`, which is the FIRST case RMD044 names — and reading `.__isComponent` off it
  // threw a TypeError from inside the JSX factory before the report at the bottom could be reached.
  // In production, where there is no report at all, that TypeError took the whole render down for a
  // fault this function is written to survive: the last line renders an empty host instead.
  if (name !== undefined && name !== null && (name as ComponentClassKind).__isComponent) {
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
      // Cast because this branch is the one place the 1-1 rule is already broken:
      // the function returns whatever it likes. It is unreachable from typed code,
      // and it has just been reported.
      return (name as UnsupportedTagFn)(attributes as never) as VNode;
    } catch (e) {
      if (__DEV__) {
        // No code of its own: RMD011 has already named this mistake one line above, and what
        // follows is the crash it caused. A second code for the consequence of the first would put
        // two entries in the reference for one fault.
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
    // `typeof` alone is `"object"` or `"undefined"` for every one of these, which would make the
    // first bad tag in an application the only one ever reported. The component is what tells two
    // of them apart — a failed import in one file and a bad map lookup in another.
    const owner = renderingOwner();
    diagnose("RMD044", `${owner}:${typeof name}`, `A tag of type ${typeof name} was passed, from ${owner}.`, {
      kind: typeof name,
      owner,
    });
  }

  return createRamonda(HOST_TAG, {}, []);
}
