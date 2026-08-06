import { ramondaLog } from "./logger";
/**
 * DEV-only diagnostics: catch code that fights the framework's design, name the
 * problem, and say what to do instead.
 *
 * Every call site is wrapped in `if (__DEV__)` so production builds strip both
 * the checks and this module. Diagnostics are deduplicated — most of these fire
 * from the render path, and a warning that repeats on every render is a warning
 * developers learn to ignore.
 */
export type DiagnosticCode =
  | "RMD001"
  | "RMD002"
  | "RMD003"
  | "RMD004"
  | "RMD005"
  | "RMD006"
  | "RMD007"
  | "RMD008"
  | "RMD009"
  | "RMD010"
  | "RMD011"
  | "RMD013"
  | "RMD014"
  | "RMD015"
  | "RMD016"
  | "RMD017"
  | "RMD018"
  | "RMD019"
  | "RMD020"
  | "RMD021"
  | "RMD022"
  | "RMD023"
  | "RMD024"
  | "RMD025"
  | "RMD027"
  | "RMD028"
  | "RMD029"
  | "RMD030"
  | "RMD031"
  | "RMD032"
  | "RMD033"
  | "RMD034";
interface DiagnosticSpec {
  /**
   * The rule, and it is about the OUTCOME rather than how bad the code looks:
   *
   * - **error** — the end result is wrong. Something renders the wrong thing, loses state, never
   *   becomes interactive, or hands the reader a value that is not what they asked for. Someone
   *   will act on wrong data. The devtools panel raises its alert only for these.
   * - **warning** — the result is the same, the app just does more work to get there: a wasted
   *   render, a refetch, a listener re-attached, a cache missed.
   */
  severity: "warning" | "error";
  title: string;
  /** What to do instead. Always concrete — never "check your code". */
  fix: string;
}
const SPECS: Record<DiagnosticCode, DiagnosticSpec> = {
  RMD001: {
    severity: "error",
    title: "State written during render()",
    fix: "render() must be pure — it reads state, it does not write it. A write here schedules another render from inside a render, which double-renders at best and loops forever at worst. Derive with @compute, sync from props with @watchProp, or write from @create / an event handler.",
  },
  RMD002: {
    severity: "error",
    title: "Duplicate key in a child list",
    fix: "Keys must be unique among siblings. Two children with the same key means only one can be matched — the other is treated as new, so state and DOM silently go to the wrong node. Use a stable id from your data, not the array index.",
  },
  RMD003: {
    // An error, not a warning, for one concrete reason: the devtools panel only raises its alert
    // on `error` (see its `alertError`), and a missing provider is precisely the kind of fault
    // that otherwise ships — the page renders, the default fills in, and nothing looks wrong.
    severity: "error",
    title: "Context consumed without a provider above it",
    fix: "The consumer is falling back to the context's default value. Mount the matching Provider hook on an ancestor component — a context is only visible to the providing component and its descendants.",
  },
  RMD004: {
    severity: "error",
    title: "Props mutated by the receiving component",
    fix: "Props are owned by the parent, so the write has nothing to write to — it throws rather than being dropped, because a write that silently does nothing leaves the component running on a value nobody set. Copy the value into @state if this component owns it from here on, or call a callback prop to ask the parent to change it. Hook options behave identically (RMD015).",
  },
  RMD005: {
    severity: "error",
    title: "Array in state mutated in place",
    fix: "A signal fires when it is assigned a new value, not when the value it holds changes inside. Replace the array instead: `this.items = [...this.items, next]`, `this.items = this.items.filter(...)`. Reassigning the same array after mutating it does not help either — the signal compares references and sees no change. This report covers ARRAYS only: a mutation goes through a method there (`push`, `splice`, `sort`), which can be watched, while `this.user.name = 'x'` is a property assignment with no such seam. An object mutated in place is the same silent no-op and nothing reports it, so the rule — replace, do not change in place — is what to follow rather than the absence of this message.",
  },
  RMD006: {
    severity: "error",
    title: "Timer still running after unmount",
    fix: "Use @interval / @timeout, which start on mount and clear themselves on unmount. If you need a raw timer, keep its id in a class property and clear it from @destroy — a returned closure cannot do this, which is exactly why cleanup lives on a property.",
  },
  RMD007: {
    severity: "error",
    title: "Server and client rendered different output",
    fix: "Hydration adopts the server DOM, so render() must produce the same result on both sides — where they disagree the server markup is overwritten and the page flickers. `new Date()` / `Math.random()` in render(): move the value into @create and mark it @persist, so the client restores the server's value instead of recomputing a new one. `typeof window` (or localStorage / window size) in render(): don't branch on the side — render the server's markup on both, then switch after hydration with `@state isClient = false` plus `@mount({ env: 'client' }) markClient() { this.isClient = true }`. The hydrating render still sees false, so it matches; the client re-renders a tick later.",
  },
  RMD008: {
    severity: "warning",
    title: "State changed after the component was unmounted",
    fix: "The component is gone, so the update is dropped and the render it asked for never happens. Something outlived it: almost always an await that resolves late (a fetch, a timer, a subscription callback) and writes state on the way back. Cancel it from @destroy — keep an AbortController or the subscription handle in a class property and tear it down there. @interval / @timeout and a subscription decorator's cleanup already do this for you.",
  },
  RMD009: {
    severity: "error",
    title: "Update loop — a component never stopped re-rendering",
    fix: "Rendering wrote state that scheduled another render of the same component, forever; without this guard the tab freezes. The usual causes are two @updated methods writing what the other reads (they re-trigger each other), and a write in render() itself (see RMD001). A post-render write must converge — assigning the same value is not a change, so it schedules nothing. Derive values with @compute instead of syncing them with an effect, and if two pieces of state must agree, make one of them @compute from the other rather than writing both.",
  },
  RMD010: {
    // error, not warning: the parent rearranges or deletes the markup, so the page is not what was written.
    severity: "error",
    title: "The default host is not allowed in this parent",
    fix: "Give the component an explicit host tag that the parent accepts — the `suggestion` below is the one that fits. A component is always exactly one element; the default <ramonda-host> is only styled to be layout-neutral, and a handful of parents (the table family, <select>, list elements, SVG) accept only specific children. This is why the check can be exact rather than a guess: it reads the actual parent node at mount.",
  },
  RMD011: {
    severity: "error",
    title: "A function was used as a JSX tag",
    fix: "In Ramonda every JSX tag is exactly one element — that is what lets you read the DOM structure straight off the JSX. A function has no element, so as a tag it would be a lie. What did you want it for? For state or lifecycle without an element of its own: use a Hook (`this.use(MyHook)`) — hooks have @state, @create/@destroy, @watchProp and @onWindow, and add no node. For state or lifecycle where an inert element is fine: just make it a component and let it render null — the default <ramonda-host> is display:contents, so it costs no layout. For plain vnodes: call the function as an expression — `{rows()}` — where it reads as the value it is, instead of pretending to be a component.",
  },
  RMD014: {
    severity: "error",
    title: "A list was given both `as` and `render`, or neither",
    fix: "A list needs exactly one way to turn an item into markup. Use `as: RowView` when an item maps to a component — the list then builds `<RowView item={item} />` itself, with no per-item function to write. Use `render: (item) => <li>{item.name}</li>` when an item maps to plain markup instead. Giving both is not an error TypeScript lets through, so this is what a JavaScript app sees: `as` wins and the render callback is never called, which renders the wrong thing quietly. Giving neither leaves the list with nothing to build.",
  },
  RMD015: {
    severity: "error",
    title: "Hook options assigned by the hook that received them",
    fix: "Options belong to whoever called `this.use(...)`, and the hook re-reads them from the owner on every render — so an assignment here has nothing to write to, and it throws rather than being dropped. Copy the value into @state if the hook owns it from here on, or take a callback option and ask the owner to change it. This is the same rule as a component's props (RMD004).",
  },
  RMD016: {
    // error, not warning: cleanup never runs and every render goes into nodes nobody can see.
    severity: "error",
    title: "A component updated while its element is not in the document",
    fix: "Something removed this component's DOM without telling the framework, so it is still mounted: its timers still fire, its listeners are still attached, its signals still hold it, and every render it does goes into nodes nobody can see. @destroy never ran. Ramonda's own removals are safe — a conditional render, a key change, a dropped list item all unmount properly — so this comes from outside: a `ref` handed to a library that clears or replaces the node, an app embedded in a page whose host removed the mount point, or a hand-written innerHTML. Call `unmount(container)` before the DOM goes away; removing the element is not a substitute. If the tree is detached ON PURPOSE and will be inserted later, this is expected and the update still runs.",
  },
  RMD017: {
    // error, not warning: the page looks finished but that subtree never becomes interactive.
    severity: "error",
    title: "A deferred hydration never resumed",
    fix: "This component returned a promise from deferHydration(), so the client adopted the server's markup and left the subtree untouched — waiting to hydrate it once the promise settled. It never did. The page therefore LOOKS finished: the server's content is on screen, correct and complete, but nothing in this subtree has listeners or state and nothing in it responds to a click. The usual cause is a dynamic import that neither resolves nor rejects — a chunk removed by a deploy, a request that hangs. Make the promise settle: give the fetch a timeout, or reject it, so the component can render its own failure. A rejected promise still releases the subtree; only one that never settles leaves it frozen.",
  },
  RMD018: {
    severity: "error",
    title: "State written during a @compute",
    fix: "A @compute must be a pure function of what it reads — it derives a value, it does not write one. A write here is worse than the same write in render() (RMD001): if the @compute reads the signal it wrote, it invalidates its own cache and recomputes forever; if it reads another, every read of the compute now also fires that signal's listeners, re-rendering components that only wanted to read a derived value. To count runs or otherwise instrument a compute, use a plain (non-@state) field — render re-runs on the same changes and will read its latest value. To produce a value, return it. To cause an effect, do it in an event handler, @updated or a subscription, never while deriving.",
  },
  RMD019: {
    severity: "error",
    title: "State set to a value that cannot be serialized",
    fix: "@state is carried to the client in the hydration blob as JSON, so it can only hold JSON-serializable data — a function, symbol or bigint is silently lost there, and the client would hydrate with a hole where this field was. Keep behaviour off state: a function belongs on the class as a method, or is passed in as a prop; a symbol/bigint should be a string or number in state. If this field is genuinely local to the client and never meant to travel, it should not be @state at all — use a plain field.",
  },
  RMD020: {
    severity: "warning",
    title: "render() produced a different value the second time",
    fix: "Two renders in the same tick, with no state change between them, must produce the same values — anything that differs was built in place by the render itself, or does not come from state at all. Development builds render twice to check; production renders once and this check is stripped.",
  },
  RMD021: {
    // error, not warning: in a @compute the value freezes, so the reader is shown a number that stopped moving.
    severity: "error",
    title: "A clock or a random number was read during render() or a @compute",
    fix: "Both have to be a function of their inputs. In render() a value read from outside makes the output depend on WHEN it ran, so a server render and its hydration disagree and the markup is thrown away (RMD007). In a @compute it is quieter and worse: the answer is cached, so the value is frozen at the moment it was first asked for and only a dependency the compute actually READ can refresh it. Read it once in @create and keep it in @state (or @persist, so it survives hydration), take it as a prop, or read it in the event handler that needs it.",
  },
  RMD022: {
    severity: "warning",
    title: "A hook's props callback built a new value for the same contents",
    fix: 'Every prop is a signal, so a fresh reference is a change: a @compute reading it recomputes, a @watchProp on it fires, and a subscription whose connect reads it reconnects — every time the callback runs. This is reported only when the value was rebuilt on four consecutive runs WITHOUT ever moving, so a prop that genuinely changes each time is not it, and neither is a callback that runs once and is then cached. For an array or an object, hold it somewhere that HAS an identity — a @compute (@compute get key() { return ["user", this.props.id] }), a field, a module constant — so the bag receives the same value instead of a fresh one, and the identity follows what it was derived from rather than a comparison. If you own the hook, @StableProps("key") declares the prop a value and settles it for every call site at once. For a function, a bound method (fetch: self.load) reads this when it is called, so there is nothing to capture; @memoizedHandler when it has to be built per argument. A @compute holding the whole bag fixes every value in it at once. If the two calls produced different CONTENTS, the callback is not a function of state — read the value once in @create and keep it in @state; that one is reported the first time it happens.',
  },
  RMD023: {
    // error, not warning: items are matched by position, so state lands on the wrong row.
    severity: "error",
    title: "An array was rendered straight into children",
    fix: "Use list() instead of mapping in place: list({ each: items, as: Row }) when an item maps to a component, or list({ each: items, render: this.renderRow }) with a bound method for plain markup. Two reasons, and the second is the one that bites: a map builds every vnode on every render, where a list is lazy (a 500-row table's render is 0.04% of its commit, because the second render rebuilds the descriptor and not the items) — and a raw array's rows are matched by POSITION, so inserting at the top hands every row below it the previous row's state and DOM, while a list mints identity from the items themselves. `each` accepts null and undefined, so there is no `?? []` to write.",
  },
  RMD030: {
    // error, not warning: the panel then shows values the app did not have, to the reader least
    // able to doubt them. The wasted renders are the smaller half of it.
    severity: "error",
    title: "State written during [INSPECT]()",
    fix: "[INSPECT]() describes an instance; it does not change one. The panel calls it on every commit while it is open on the components tab, so a write here closes a circle: the write schedules a render, the render commits, the commit pings the panel, and the panel asks again. The app changes under the person debugging it, and the values on screen are no longer the values it had — at exactly the moment someone is trying to work out what is wrong. Read fields, derive values, and return. If a value has to be computed, compute it into a local; if it has to be cached, cache it in a plain field rather than @state, the way Form and Mutation hold what their version counter stands for.",
  },
  RMD029: {
    // error, not warning: the element does the OPPOSITE of what the line says.
    severity: "error",
    title: 'A boolean attribute given the string "false"',
    fix: 'A boolean attribute is true whenever it is PRESENT — the parser never reads its value — so `disabled="false"` disables the control and `hidden="false"` hides the element. Pass the boolean itself: `disabled={false}`, or `disabled={someCondition}`. A `false` removes the attribute, which is what makes it off. This is not fixed for you on purpose: `<input disabled="false">` is disabled in every browser by the HTML spec, and a framework that quietly decided otherwise would make its JSX mean something different from the markup it produces. Only the exact string "false" is reported, and only on a genuinely boolean attribute — `aria-hidden="false"` is valid and means what it says, because ARIA attributes are enumerated strings rather than boolean attributes.',
  },
  RMD028: {
    // error, not warning: the page's structure is not the one that was written, and the diff then
    // walks a tree it did not build.
    severity: "error",
    title: "An element the HTML parser is not allowed to keep here",
    fix: "The client builds the DOM with appendChild, which puts a node exactly where it is told — so this works until the page is server-rendered, and then a parser moves it. A <div> inside a <p> becomes the <p>'s sibling; an <li> outside a list, a <tr> outside a table, an <option> outside a select are all relocated; a nested <form> is dropped and a nested <a> closes the outer one. After the move the DOM is not the tree render() described, so hydration reports a mismatch (RMD007) about non-determinism, which is not what went wrong. Put the element where the parser allows it: a block element beside the <p> rather than inside it, list items in a <ul>, rows in a <table>. If a component renders the misplaced element, give it the right @Host.",
  },
  RMD027: {
    // error, not warning: the hook keeps running on a value the app has already moved past, so
    // what renders is not what the state says. Nothing is merely slower here.
    severity: "error",
    title: "A props callback reads a value that is not reactive",
    fix: "A hook's props callback is cached on the signals it reads, so a render where none of them moved does not call it again. This prop came out different anyway, which means the value reaching it never passes through a signal — most often a plain field standing in for state (`items = []` rather than `@state items = []`), or a module-level variable something mutates. It used to work by accident: the write scheduled nothing, and the next render for any other reason happened to rebuild the bag. Make the value reactive and both problems go away at once — `@state` for something the component owns, `@compute` for something derived, a context signal for something shared. If it genuinely cannot be reactive (a `Date.now()`, a random id), read it once in `@create` and keep the result in `@state` instead of reading it in the callback.",
  },
  RMD025: {
    // error, not warning: the reader gets nothing where the server had a value.
    severity: "error",
    title: "Per-request data read in the browser",
    fix: '`requestContext()` reads the real request on the SERVER. In the browser only what the server explicitly exposed is available, so this read returned nothing — and if the server rendered a value here, the two sides now disagree and hydration will replace the node. Cookies and headers are never exposed (they are the server\'s, and an httpOnly cookie is invisible to JS anyway). To carry a value to the client, opt its key in — `requestKey("currentUser", { exposeToClient: true })` — and expose only what is safe to publish: a display name, an id, a role, never a session token. Better still, read the request in `@create` and keep the result in `@state`: `@create` is skipped on hydration and the state is restored from the page, so the browser never re-reads the request at all.',
  },
  RMD024: {
    severity: "warning",
    title: "A @compute recomputes without its answer changing",
    fix: "A @compute is invalidated by the signals it READ, so if it recomputes on every pass while producing an equal value, something it reads is being replaced every time — most often an array or object literal rebuilt in a hook's props bag, or a value derived from one. Declare that prop with @StableProps if you own the hook, and hold the value somewhere stable if you do not — a @compute of its own, a field, a module constant. If nothing is being rebuilt, the compute is reading something that is not reactive at all — a counter, Date.now(), a module variable — and a @compute is the wrong place for that: read it once in @create and keep it in @state.",
  },
  RMD013: {
    severity: "error",
    title: "A list could not identify its items",
    fix: "Every row a list renders needs an identity and a vnode. If a key callback returned the same value twice, two rows are claiming one identity — drop the `key` option entirely and let the list mint identity from the items themselves, which cannot collide; keep `key` only if your items are re-created as fresh objects for the same entity, and then return a field that really is unique. If the render callback returned nothing, give it something to render for that item, or filter the item out of `each` before it gets here.",
  },
  RMD034: {
    // error, not warning: the value the reader sees is not the value the app set. Nothing renders,
    // and the page goes on showing what it showed before.
    severity: "error",
    title: "Object in state changed in place",
    fix: "A signal fires when it is ASSIGNED a new value, not when the value it holds changes inside — so `this.user.name = 'x'` writes into the object the signal already has, nothing compares as different, and nothing re-renders. Replace it instead: `this.user = { ...this.user, name: 'x' }`, and for something nested, rebuild the path: `this.user = { ...this.user, address: { ...this.user.address, city } }`. @ramonda/lens does exactly that with less typing: `this.user = focusOn(this.user).get('address').get('city').set(city)`. Reassigning the same object after changing it does not help either — the signal compares references and sees no change.",
  },
  RMD033: {
    // error, not warning: development stops at it, and in production the handler is rebuilt on every
    // render — so everything it is passed to re-renders with it, for the life of the page.
    severity: "error",
    title: "A memoized handler was given an argument it cannot key on",
    fix: "@memoizedHandler caches by the ARGUMENTS, and a cache key can hold a string, a number or a boolean. An object cannot: comparing it by value is not something the cache can do, and keying on its identity would miss every time — a fresh object per render would fill the map and hand back a new handler on every pass, which is the churn the decorator exists to prevent. Pass the primitive the object stands for — `row.id` rather than `row` — and read the rest inside the handler. Development throws so the mistake is not shipped; production builds the handler and moves on WITHOUT caching that call, so the page keeps working and only the memoisation is lost.",
  },
  RMD032: {
    // error, not warning: the last declaration wins, so errors go to a handler the author did not
    // pick, and the one they were reading goes silent.
    severity: "error",
    title: "More than one @catchError on a component",
    fix: 'A component has one answer to "who handles an error from below?", and the last @catchError declared is the one that gets it — the others never run, silently. Keep one and let it decide: it receives the error, and returning `false` declines it so the next boundary above takes over. A SUBCLASS declaring its own is not this: that is an override, and it is fine. This is two on the same class.',
  },
  RMD031: {
    // error, not warning: the item is dropped, so the list on screen is shorter than `each`.
    severity: "error",
    title: "A list item that is not an element",
    fix: "A list writes each row's key onto the vnode it gets back, and the diff matches rows on that key — so one item has to become exactly one element. A string or a number is not one: wrap it, `render: (name) => <li>{name}</li>`. A nested `list()` is not one either, and it is the common case: a list of pages, each holding a list of rows. Nesting goes through a COMPONENT rather than a bare descriptor — `render: (page) => <PageView item={page} />`, or `as: PageView` — because the component's host element is what wraps the inner rows and carries the key. The item is skipped rather than rendered, so the page is missing a row wherever this fires.",
  },
};
/** Bounds the dedup set — a runaway dynamic key can't grow it without limit. */
const MAX_TRACKED = 1000;
const reported = new Set<string>();
/**
 * Reports a diagnostic once per `dedupKey`. Pick a `dedupKey` that identifies
 * the *source* of the problem (component + property), not the occurrence, so a
 * loop reports once rather than once per iteration.
 */
export function diagnose(code: DiagnosticCode, dedupKey: string, detail?: string, data?: unknown): void {
  const id = `${code}:${dedupKey}`;
  if (reported.has(id)) return;
  if (reported.size < MAX_TRACKED) reported.add(id);
  const spec = SPECS[code];
  const message = `[${code}] ${spec.title}${detail ? `\n${detail}` : ""}\n\n→ ${spec.fix}`;
  ramondaLog(spec.severity, message, data);
}
/** Test-only: lets each test observe a diagnostic that a previous one deduped. */
export function resetDiagnostics(): void {
  reported.clear();
}
