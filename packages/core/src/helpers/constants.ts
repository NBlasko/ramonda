export const svgNamespaceUri = "http://www.w3.org/2000/svg";

/**
 * Re-exported so that everything in this package still imports it from here.
 *
 * The list itself moved to `@ramonda/dom-facts`, because `@ramonda/check` needs the same one to say
 * what this package will do with a tag — and two copies of it had already drifted by twenty-one
 * names before a test caught them. That package publishes nothing and is bundled in, so this ships
 * exactly the bytes it shipped before.
 */
export { svgElements } from "@ramonda/dom-facts";

export const DONE = 5;
export type DONE = 5;
export const TEXT_TYPE = 6;
export type TEXT_TYPE = 6;
export const COMPONENT_TYPE = 7;
export type COMPONENT_TYPE = 7;

export const IS_SVG = Symbol("isSvg");
export const KEY_SYM = Symbol("key");
/**
 * The JSX child slot this node was built for — its index among its parent's children,
 * counting the ones that render nothing.
 *
 * A conditional child is invisible in the DOM, so a node's POSITION among its siblings
 * moves when one appears or disappears while the piece of JSX that produced it did not.
 * Matching by position then hands a child the node its neighbour was using: attributes and
 * text are patched either way, so the page reads correctly while focus, scroll, uncontrolled
 * input state and element identity have moved. The slot is what stays still.
 *
 * The alternative was to give the hole a real placeholder node in the DOM, so that positions
 * never move. That works, and costs a node per conditional forever. This keeps the DOM clean
 * by putting the slot on the node instead, next to `KEY_SYM`, which the node already carries.
 *
 * `undefined` means "not stamped yet": a server-rendered node the client has just adopted.
 * Those are matched positionally, exactly as before, and stamped as they are claimed.
 */
export const SLOT_SYM = Symbol("slot");
/** The `Ref` currently pointing at an element, so unmount can clear it. */
export const REF_SYM = Symbol("ref");
/** The style string last written to an element, for the attribute diff to compare against. */
export const STYLE_SYM = Symbol("style");

/** The component whose render() built this vnode / this DOM node. See core/origin.ts. */
export const ORIGIN_SYM = Symbol("origin");
/** Brands the opaque object a built list is. See types/vdom.ts → ListNode. */
export const IS_LIST = Symbol("isList");
/**
 * The "take these props?" rule a component declared with
 * `@ShouldUpdateOnPropsChange`, held on the CLASS.
 *
 * On the constructor rather than per instance, so it is inherited through the
 * static chain — a subclass gets the base's rule, and declaring its own shadows
 * it — and so `Object.hasOwn` can tell a real double-declaration from an
 * override.
 */
export const PROPS_GATE = Symbol("propsGate");
/** The prop names a hook declared with `@StableProps`, held on the class. */
export const STABLE_PROPS = Symbol("stableProps");
/**
 * DEV only. Marks a children array that `normalizeChildren` built — so a nested array
 * WITHOUT it came from the app (a `.map`, a `filter`, an array literal) rather than from
 * JSX or from `{this.props.children}` being passed down. See RMD023.
 */
export const OWN_CHILDREN = Symbol("ownChildren");
/**
 * Set by `flattenMixedArray` on a children array holding at least one REGION — a list, or a
 * component — so the diff can take the cheap path (a strict equality check) instead of scanning
 * every child of every element on every render to find out.
 *
 * A component counts because it owns a RANGE: its render may produce two nodes, or none, and which
 * of the parent's children are its own is a question `childNodes` cannot answer. It was named
 * `HAS_LIST` while a list was the only thing that owned more than one node.
 */
export const HAS_REGION = Symbol("hasRegion");
/**
 * The child record, on elements that own at least one region — a list or a component. Holds this
 * element's children in render order, with each region collapsed to ONE entry, which is what keeps
 * a region's keys from being reachable by its siblings. Absent on an element whose children are all
 * plain markup, which keeps reading `childNodes` as it always has.
 */
export const CHILD_RECORD = Symbol("childRecord");
/**
 * On a `ChildrenRegion`'s OPENING anchor comment: the closing one.
 *
 * A block's record hangs off that same comment, and a reader that finds it needs to know where the
 * block ends — to insert inside it rather than past every other block in a shared target. The anchor
 * is a permanent node in the target, so putting both there is what lets an ordinary walk over the
 * parent's children find a block without anything keeping a registry of live regions.
 */
export const BLOCK_CLOSE = Symbol("blockClose");
/**
 * On a `ChildrenRegion`'s OPENING anchor: the region itself, so a teardown can tell it.
 *
 * A block lives in an element it does not own, and that element may be removed by whoever DOES own
 * it. The nodes go with it — they are inside it — but the region has to hear about it, or it keeps
 * believing the components in there are mounted: measured, a later `reconcile` adopted a destroyed
 * instance, RMD008 reported a write after unmount, and the block moved that dead markup into the
 * live DOM where it could never update again.
 *
 * Typed as the one method the teardown calls, so nothing outside `core/` needs the class.
 */
export const BLOCK_OWNER = Symbol("blockOwner");

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

/**
 * Per instance: the PRIMITIVE value each serialized field's own initializer produced.
 *
 * Read by the serializer, which leaves a field out of the hydration blob when it still holds that
 * value — the client's initializer produces it again, so restoring it is a no-op and the bytes buy
 * nothing. Measured on a form of five rows: 942 of 1935 bytes were hydration state, nearly all of
 * it `{"version":0}` from the subscription counters.
 *
 * **Primitives only, and that is a correctness bound rather than a saving.** An in-place mutation
 * (`this.rows.push(…)`) keeps the object the initializer produced, so an identity test would call
 * a filled array untouched and empty it on hydration — measured: the mutated array reaches the blob
 * today, RMD005 and all. A primitive cannot be mutated in place, so the question cannot arise.
 *
 * Not behind `__DEV__`: what it saves is bytes a production page ships.
 */
export const INITIAL_PRIMITIVES = Symbol("initialPrimitives");

/**
 * Marks an element the framework placed in a target — a `Portal`'s children in its
 * target, and the `Head` hook's tags in `document.head` (which manages them the same
 * way, keyed by selector). The one thing that tells framework-managed head elements
 * apart from the shell's own.
 *
 * Two jobs, both across the server→client boundary. The server renderer collects
 * these by it — `renderToString` returns only the body, so a tag placed in
 * `document.head` is otherwise lost. And on the client they are found and ADOPTED by
 * it, rather than a second copy being appended over what the server already wrote.
 */
export const PORTAL_ATTR = "data-ramonda-portal";

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
