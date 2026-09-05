import { ramondaLog } from "./logger";

/**
 * One diagnostic as a collector receives it — the record every reporting package shares,
 * documented at https://ramonda.dev/reference/diagnostics#capturing-them.
 *
 * Declared here rather than imported, and that is the whole design: a package that reports
 * something must be free to have no dependencies, so what is shared is the SHAPE and the name
 * of the sink, never a module. `@ramonda/devtools` compares these declarations across packages,
 * which is what keeps the copies identical.
 */
declare global {
  interface RamondaDiagnostic {
    code: string;
    scope: string;
    severity: "debug" | "info" | "warn" | "error";
    message: string;
    fix?: string;
    data?: Record<string, unknown>;
    time: number;
    dedupKey?: string;
  }

  var __RAMONDA_DIAGNOSTICS__: ((record: RamondaDiagnostic) => void) | undefined;
}
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
  | "RMD011"
  | "RMD013"
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
  | "RMD034"
  | "RMD035"
  | "RMD036"
  | "RMD037"
  | "RMD038"
  | "RMD039"
  | "RMD040"
  | "RMD043"
  | "RMD044"
  | "RMD046"
  | "RMD047"
  | "RMD048"
  | "RMD049"
  | "RMD050"
  | "RMD051"
  | "RMD052"
  | "RMD053"
  | "RMD055"
  | "RMD056"
  | "RMD057"
  | "RMD058"
  | "RMD059"
  | "RMD060"
  | "RMD061"
  | "RMD062"
  | "RMD063"
  | "RMD064";
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
  /**
   * For a code about a decorator written TWICE: which decorators, and what the second one does.
   *
   * Here because it is a fact about this framework's runtime, and it is needed OUTSIDE it.
   * `@ramonda/check` reports the same faults before anything runs, and its advice has to say the same
   * thing — "they merge, nothing is lost" for `@StableProps`, "one of them never runs" for
   * `@catchError`. That sentence used to live only in `check`, which does not import core, so the two
   * could disagree and nothing would notice: change core so a second `@StableProps` throws and the
   * analyzer keeps telling people it merges.
   *
   * `scripts/check-decorator-duplication.mjs` compares this against `check`'s table and fails the
   * build if they differ — including the quiet direction, a decorator added here and never learned
   * there, where the rule simply says nothing.
   *
   * The words are the ADVICE each one needs, which is why there are four rather than a boolean:
   * `refuses` throws so there is no live line to hunt for, `displaces` leaves dead code and the reader
   * needs to know which is live, `merges` loses nothing, `redundant` changes nothing at all.
   */
  duplicate?: {
    decorators: readonly string[];
    effect: "refuses" | "displaces" | "merges" | "redundant";
  };
  title: string;
  /** What to do instead. Always concrete — never "check your code". */
  fix: string;
}
/**
 * Exported from this MODULE only — `index.ts` does not re-export it, so it is not published surface.
 * `__tests__/DuplicateDecoratorSpecs.test.ts` reads the `duplicate` fields to check they name real
 * decorators, which is the one way a typo could make both this table and the analyzer's agree while
 * both describe something that does not exist.
 */
export const SPECS: Record<DiagnosticCode, DiagnosticSpec> = {
  RMD001: {
    severity: "error",
    title: "State written during render()",
    fix: "render() must be pure — it reads state, it does not write it. A write here schedules another render from inside a render, which double-renders at best and loops forever at worst. Derive with @compute, sync from props with @watchProp, or write from @created / an event handler.",
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
    fix: "The consumer is falling back to the context's default value. Mount the matching Provider hook on an ancestor component — a context is only visible to the providing component and its descendants. If the default IS the answer here rather than a stand-in, say so where the context is created — `createContext(value, { optional: true })` — and this goes quiet for every consumer of it at once. The router's `params` is the example: a nav bar beside the outlet has no matched route above it, and `{}` is correct there.",
  },
  RMD004: {
    severity: "error",
    title: "Props mutated by the receiving component",
    fix: "Props are owned by the parent, so the write has nothing to write to — it throws rather than being dropped, because a write that silently does nothing leaves the component running on a value nobody set. Copy the value into @state if this component owns it from here on, or call a callback prop to ask the parent to change it. A hook's props behave identically (RMD015).",
  },
  RMD005: {
    severity: "error",
    title: "Array in state mutated in place",
    fix: "A signal fires when it is assigned a new value, not when the value it holds changes inside. Replace the array instead: `this.items = [...this.items, next]`, `this.items = this.items.filter(...)`. Reassigning the same array after mutating it does not help either — the signal compares references and sees no change.",
  },
  RMD006: {
    severity: "error",
    title: "Timer still running after unmount",
    fix: "Use @interval / @timeout for a clock that starts at mount, or the Timeout / Interval hooks for one you start yourself: `private t = this.use(Timeout, () => ({ run: this.done }))`, then `this.t.start(ms)`, and `this.t.stop()` to end it early. Both clear themselves on teardown, so there is no id to keep. If you do write a raw timer, its id has to live on a class property so @destroyed can reach it — a returned closure cannot, which is why the fallback is a property.",
  },
  RMD007: {
    severity: "error",
    title: "Server and client rendered different output",
    fix: "Hydration adopts the server DOM, so render() must produce the same result on both sides — where they disagree the server markup is overwritten and the page flickers. `new Date()` / `Math.random()` in render(): move the value into @created and mark it @persist, so the client restores the server's value instead of recomputing a new one. `typeof window` (or localStorage / window size) in render(): don't branch on the side — render the server's markup on both, then switch after hydration with `@state isClient = false` plus `@mounted({ env: 'client' }) markClient() { this.isClient = true }`. The hydrating render still sees false, so it matches; the client re-renders a tick later.",
  },
  RMD008: {
    severity: "warning",
    title: "State changed after the component was unmounted",
    fix: "The component is gone, so the update is dropped and the render it asked for never happens. Something outlived it: almost always an await that resolves late (a fetch, a timer, a subscription callback) and writes state on the way back. Cancel it from @destroyed — keep an AbortController or the subscription handle in a class property and tear it down there. @interval / @timeout, the Timeout / Interval hooks and a subscription decorator's cleanup already do this for you.",
  },
  RMD009: {
    severity: "error",
    // A colon rather than an em dash: the reference writes a heading as "## RMD009 — <title>", and a
    // title carrying its own dash reads as two separators there. The production counter says it the
    // same way — `Task.ts`, "Update loop: one update rebuilt components …".
    title: "Update loop: a component never stopped re-rendering",
    fix: "Rendering wrote state that scheduled another render of the same component, forever; without this guard the tab freezes. The usual causes are two @updated methods writing what the other reads (they re-trigger each other), and a write in render() itself (see RMD001). A post-render write must converge — assigning the same value is not a change, so it schedules nothing. Derive values with @compute instead of syncing them with an effect, and if two pieces of state must agree, make one of them @compute from the other rather than writing both.",
  },
  RMD011: {
    severity: "error",
    title: "A function was used as a JSX tag",
    fix: "A JSX tag is either an element name or a component class, and a plain function is neither: nothing constructs it, it has no state and no lifecycle, and the framework has nowhere to put what it returns. What did you want it for? For markup you reuse, call the function in an expression slot — `{sideBar()}` — where it reads as the value it is. For state, lifecycle or hooks with no markup of its own, use a Hook (`this.use(MyHook)`). For state AND markup, make it a component: a component owns whatever its render returns, including nothing at all, so it needs no element to justify itself.",
  },
  RMD015: {
    severity: "error",
    title: "A hook's props assigned by the hook that received them",
    fix: "A hook's props belong to whoever called `this.use(...)`, and the hook re-reads them from the owner on every render — so an assignment here has nothing to write to, and it throws rather than being dropped. Copy the value into @state if the hook owns it from here on, or take a callback prop and ask the owner to change it. This is the same rule as a component's props (RMD004).",
  },
  RMD016: {
    // error, not warning: cleanup never runs and every render goes into nodes nobody can see.
    severity: "error",
    title: "A component updated while its element is not in the document",
    fix: "Something removed this component's DOM without telling the framework, so it is still mounted: its timers still fire, its listeners are still attached, its signals still hold it, and every render it does goes into nodes nobody can see. @destroyed never ran. Ramonda's own removals are safe — a conditional render, a key change, a dropped list item all unmount properly — so this comes from outside: a `ref` handed to a library that clears or replaces the node, an app embedded in a page whose host removed the mount point, or a hand-written innerHTML. Call `unmount(container)` before the DOM goes away; removing the element is not a substitute. If the tree is detached ON PURPOSE and will be inserted later, this is expected and the update still runs.",
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
    title: "A random number was read while a value was being derived",
    fix: "A derived value has to be a function of its inputs, and `Math.random()`, `crypto.randomUUID()` and `crypto.getRandomValues()` are not one. Four places derive, and the same call is kept for a different length of time in each. In render() the output depends on WHEN it ran, so a server render and its hydration disagree and the markup is thrown away (RMD007). In a @compute the answer is cached, so the value is frozen at the moment it was first asked for and only a dependency the compute actually READ can refresh it. In a @memoized builder it is frozen into the cache entry, which outlives the render that asked for it. In a hook's props callback it is frozen into the bag until something unrelated invalidates the callback, and then it jumps. Read it once in @created and keep it in @state (or @persist, so it survives hydration), take it as a prop, or read it in the event handler that needs it. The CLOCK is deliberately not watched here: the platform reads it behind your back — an Event constructor stamps `timeStamp` — so a guard on it would report calls the app never made. `new Date()` in a render is caught by RMD020 as a fresh identity, `Date.now()` by RMD007 when a hydration disagrees, and `ramonda-check` catches both before they ship, as `clock-read-while-rendering`.",
  },
  RMD022: {
    severity: "warning",
    title: "A hook's props callback built a new value for the same contents",
    fix: 'Every prop is a signal, so a fresh reference is a change: a @compute reading it recomputes, a @watchProp on it fires, and a subscription whose connect reads it reconnects — every time the callback runs. This is reported only when the value was rebuilt on four consecutive runs WITHOUT ever moving, so a prop that genuinely changes each time is not it, and neither is a callback that runs once and is then cached. For an array or an object, hold it somewhere that HAS an identity — a @compute (@compute get key() { return ["user", this.props.id] }), a field, a module constant — so the bag receives the same value instead of a fresh one, and the identity follows what it was derived from rather than a comparison. If you own the hook, @StableProps("key") declares the prop a value and settles it for every call site at once. For a function, a bound method (fetch: self.load) reads this when it is called, so there is nothing to capture; @memoized when it has to be built per argument. A @compute holding the whole bag fixes every value in it at once. If the two calls produced different CONTENTS, the callback is not a function of state — read the value once in @created and keep it in @state; that one is reported the first time it happens.',
  },
  RMD023: {
    // Warning, not error: the page renders, and the fault only shows when the rows move.
    severity: "warning",
    title: "Children built from an array need a key",
    fix: "Give each one a `key` from your data — an id, not the array index, which IS the position and so changes nothing. Without a key these rows are matched by POSITION, so inserting or removing anywhere but the end hands every row below it the previous row's state and DOM: a half-typed input, an open menu, a scroll position, all one row off, while the page still looks right. Rows built this way cannot be confused with the siblings around them — that boundary holds with or without a key — so what is at stake is only which row inside the array is which. `list(items, (item) => …)` is the same thing without the eager build (a 500-row table's render is 0.04% of its commit, because the descriptor is rebuilt and the rows are not), and a key is good practice there too.",
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
    fix: "The client builds the DOM with appendChild, which puts a node exactly where it is told — so this works until the page is server-rendered, and then a parser moves it. A <div> inside a <p> becomes the <p>'s sibling; an <li> outside a list, a <tr> outside a table, an <option> outside a select are all relocated; a nested <form> is dropped and a nested <a> closes the outer one. After the move the DOM is not the tree render() described, so hydration reports a mismatch (RMD007) about non-determinism, which is not what went wrong. Put the element where the parser allows it: a block element beside the <p> rather than inside it, list items in a <ul>, rows in a <table>. A component's markup is whatever its render() returns, so the element to move is the one written there.",
  },
  RMD027: {
    // error, not warning: the hook keeps running on a value the app has already moved past, so
    // what renders is not what the state says. Nothing is merely slower here.
    severity: "error",
    title: "A props callback reads a value that is not reactive",
    fix: "A hook's props callback is cached on the signals it reads, so a render where none of them moved does not call it again. This prop came out different anyway, which means the value reaching it never passes through a signal — most often a plain field standing in for state (`items = []` rather than `@state items = []`), or a module-level variable something mutates. It used to work by accident: the write scheduled nothing, and the next render for any other reason happened to rebuild the bag. Make the value reactive and both problems go away at once — `@state` for something the component owns, `@compute` for something derived, a context signal for something shared. If it genuinely cannot be reactive (a `Date.now()`, a random id), read it once in `@created` and keep the result in `@state` instead of reading it in the callback.",
  },
  RMD025: {
    // error, not warning: the reader gets nothing where the server had a value.
    severity: "error",
    title: "Per-request data read in the browser",
    fix: '`requestContext()` reads the real request on the SERVER. In the browser only what the server explicitly exposed is available, so this read returned nothing — and if the server rendered a value here, the two sides now disagree and hydration will replace the node. Cookies and headers are never exposed (they are the server\'s, and an httpOnly cookie is invisible to JS anyway). To carry a value to the client, opt its key in — `requestKey("currentUser", { exposeToClient: true })` — and expose only what is safe to publish: a display name, an id, a role, never a session token. Better still, read the request in `@created` and keep the result in `@state`: `@created` is skipped on hydration and the state is restored from the page, so the browser never re-reads the request at all.',
  },
  RMD024: {
    severity: "warning",
    title: "A @compute recomputes without its answer changing",
    fix: "A @compute is invalidated by the signals it READ, so if it recomputes on every pass while producing an equal value, something it reads is being replaced every time — most often an array or object literal rebuilt in a hook's props bag, or a value derived from one. Declare that prop with @StableProps if you own the hook, and hold the value somewhere stable if you do not — a @compute of its own, a field, a module constant. If nothing is being rebuilt, the compute is reading something that is not reactive at all — a counter, Date.now(), a module variable — and a @compute is the wrong place for that: read it once in @created and keep it in @state.",
  },
  RMD013: {
    severity: "error",
    title: "A list item produced nothing",
    fix: "The callback returned nothing for this item, so the list on screen is a row shorter than the array. Give it something to render — a placeholder row, or the empty state you meant — or filter the item out of the array before it gets here. A callback that returned something which is not an element is RMD031 instead.",
  },
  RMD032: {
    // error, not warning: one declaration wins, so errors go to a handler the author did not pick,
    // and the one they were reading goes silent.
    duplicate: { decorators: ["catchError"], effect: "displaces" },
    severity: "error",
    title: "More than one @catchError on a component",
    fix: 'A component has one answer to "who handles an error from below?", so one @catchError gets it and the others never run, silently. **The LOWEST of them is the one that runs**: the last declaration applied is the one that stands, and members initialise top to bottom, so the one written last is applied last — the opposite of RMD040, where a class decorator applies bottom-up. Keep one and let it decide: it receives the error, and returning `false` declines it so the next boundary above takes over. A SUBCLASS declaring its own is not this: that is an override, and it is fine. This is two on the same class.',
  },
  /* ── the ten that were messages before they were codes ────────────────────────────────────
   *
   * Each of these was a `ramondaLog` call with the advice written inline: a real fault, reported,
   * but with no stable name to search for, no `fix` a panel could render apart from the message,
   * and no way for a collector to group two occurrences of one cause. Severities are the ones the
   * messages already carried — the port is about giving them identity, not about re-judging them.
   *
   * They are RMD033 upward because RMD032 was taken by `@catchError` while this was being written,
   * and a code is never reassigned.
   */
  RMD033: {
    severity: "warning",
    title: "State that cannot cross to the client",
    fix: "Only JSON-serializable state travels in the hydration blob, and it fails in three different ways. A FUNCTION is dropped, so the client starts with whatever the field initialises to. A value `JSON.stringify` throws on — a bigint, a circular object — never reaches the blob at all, and the whole component starts from its initialisers. A Date, a Map, a Set or a class instance SURVIVES: it arrives as a string or as a plain object, so the field is not missing, it is the wrong type, and the first method call on it throws. Keep the value out of state and derive it on the client — in `@created`, which does not run during hydration, or in a `@compute` — or store a serializable form of it (an id, an ISO string) and rebuild the object where it is used.",
  },
  RMD034: {
    severity: "warning",
    title: "State written during create or mount is not carried to the client",
    fix: "`@created` and `@mounted` do not run again on the client: hydration adopts the server's DOM and restores state from the blob. So a value computed there is server-only unless it is `@state` (which is serialized) or marked `@persist`. Mark it `@persist` if the client needs the server's answer, or move the work to somewhere that runs on both sides.",
  },
  RMD035: {
    severity: "warning",
    title: "The client's hook tree does not match the server's",
    fix: "State is restored by position, so the two sides have to build the same hooks in the same order. A hook created behind a condition — `if (isServer) this.use(…)` — or a `this.use()` inside a branch makes the counts differ, and the state after it lands on the wrong hook or nowhere. Call every `this.use()` unconditionally, at the top of the class.",
  },
  RMD036: {
    severity: "error",
    title: "The state blob could not be read",
    fix: "The component starts from its initial values instead of the server's, so the page can differ from what was rendered and RMD007 usually follows. The blob is written into the markup, so this means it was altered on the way: HTML rewritten by a proxy or an extension, a truncated response, or markup that was manually edited. Compare what the server sent with what arrived before looking anywhere else.",
  },
  RMD037: {
    severity: "error",
    title: "An object among JSX children that is not markup",
    fix: "It is dropped, so the page renders without it. Almost always a value that was meant to be read from rather than rendered — a whole object where one of its fields belongs (`{user}` instead of `{user.name}`), a Promise that was never awaited, or a `list()` descriptor used as a child rather than returned. Render a string, a number, a vnode, or a list through `list()`.",
  },
  RMD038: {
    severity: "error",
    title: "A `@watchProp` selector threw",
    fix: "The selector returns `undefined` so the app keeps running, which means the watcher sees a change that is not one. It almost always reads through something absent, so guard the path as you drill into it — `p.foo?.[5]?.bar`. A selector is called on every props change and must be total: no assertions, no lookups that can fail.",
  },
  RMD039: {
    severity: "warning",
    title: "`class` where `className` was meant",
    fix: "Ramonda reads `className`, and a `class` written on an element is renamed to it before the vnode is built — so the element IS styled and the page is not broken. What the rename cannot save is the two cases beside it. If the element carries `className` as well, that one wins and this `class` is dropped without a word. And a COMPONENT is renamed just the same, so `<Panel class=…>` arrives as `className`: a `class` prop that component declared reads `undefined` on every render, for ever. Write `className` and both go away, and the source says what the element gets. This is the one place the JSX deliberately differs from HTML, because `class` is a reserved word in the object literal a JSX factory receives.",
  },
  RMD040: {
    duplicate: { decorators: ["ShouldUpdateOnPropsChange"], effect: "displaces" },
    severity: "error",
    title: "More than one `@ShouldUpdateOnPropsChange` on one class",
    fix: 'There can only be one answer to "take these props?", so one of them decides and the others never run — a gate that looks present and is not. **The HIGHEST of them is the one that decides**: the last declaration applied is the one that stands, and class decorators apply bottom-up, so the one written furthest from the class is applied last — the opposite of RMD032, where a member decorator initialises top to bottom. Remove the extras and combine their conditions into one callback. A SUBCLASS declaring its own is not this — that is an override, and it is silent on purpose.',
  },
  RMD043: {
    severity: "warning",
    title: "A `<meta>` with nothing to identify it",
    fix: "`Head` matches tags it has already written so an update replaces rather than appends, and a `<meta>` is matched by `name`, `property` or `http-equiv`. One with none of them cannot be found again, so it would be added on every update — it is skipped instead. Give it whichever of the three describes it.",
  },
  RMD044: {
    severity: "error",
    title: "An unknown element type in JSX",
    fix: "A tag has to be a string, a component class, or — for the one unsupported case — a function. This was none of them, so an empty host is rendered in its place and whatever it was meant to be is missing. It is usually a value used where a tag belongs: `<{Thing} />` rather than `<Thing />`, an object read off a map with the wrong key, or a component that failed to import and arrived as undefined.",
  },
  RMD046: {
    // warning, not error: the union is what the author asked for, so the result is right and only
    // the spelling is redundant.
    duplicate: { decorators: ["StableProps"], effect: "merges" },
    severity: "warning",
    title: "More than one @StableProps on one class",
    fix: '`@StableProps` names a set and already merges along the class chain, so two on one class is read as the union — the result is what you asked for, written twice. Combine them into one: `@StableProps("a", "b")`. A SUBCLASS declaring its own is not this; that ADDS to the base\'s list, which is the intended way to extend it.',
  },
  RMD031: {
    // error, not warning: the item is dropped, so the list on screen is shorter than `each`.
    severity: "error",
    title: "A list item that is not an element",
    fix: "One item has to become exactly one element, because an element is what carries the row's key and what the diff matches on. A string or a number is not one: wrap it, `list(names, (name) => <li>{name}</li>)`. A nested `list()` is not one either, and it is the common case — a list of pages, each holding a list of rows. Put a COMPONENT between them: `list(pages, (page) => <PageView item={page} />)`, because the component's host element is what wraps the inner rows. The item is skipped rather than rendered, so the page is missing a row wherever this fires.",
  },
  RMD047: {
    // error, not warning: development stops at it, and in production the handler is rebuilt on every
    // render — so everything it is passed to re-renders with it, for the life of the page.
    severity: "error",
    title: "A `@memoized` member was given an argument it cannot key on",
    fix: "@memoized caches by the ARGUMENTS, and a cache key can hold a string, a number or a boolean. An object cannot: comparing it by value is not something the cache can do, and keying on its identity would miss every time — a fresh object per render would fill the map and hand back a new handler on every pass, which is the churn the decorator exists to prevent. Pass the primitive the object stands for — `row.id` rather than `row` — and read the rest inside the handler. Development throws so the mistake is not shipped; production builds the handler and moves on WITHOUT caching that call, so the page keeps working and only the memoisation is lost.",
  },
  RMD048: {
    // error, not warning: the value the reader sees is not the value the app set. Nothing renders,
    // and the page goes on showing what it showed before.
    severity: "error",
    title: "Object in state changed in place",
    fix: "A signal fires when it is ASSIGNED a new value, not when the value it holds changes inside — so `this.user.name = 'x'` writes into the object the signal already has, nothing compares as different, and nothing re-renders. Replace it instead: `this.user = { ...this.user, name: 'x' }`, and for something nested, rebuild the path: `this.user = { ...this.user, address: { ...this.user.address, city } }`. @ramonda/lens does exactly that with less typing: `this.user = focusOn(this.user).get('address').get('city').set(city)`. Reassigning the same object after changing it does not help either — the signal compares references and sees no change.",
  },
  RMD049: {
    // error, not warning: without a key of its own, one lazy rendered another's module — the page
    // showed the wrong thing and said nothing.
    severity: "error",
    title: "Two lazy functions with the same source",
    fix: "`AsyncLoad` identifies a module by the SOURCE of its `lazy`, which works when that source names one: `() => import('./Thing')` says what it loads, so the same import written in two components shares one cache entry — which is what you want. A lazy a FACTORY built names nothing: `const make = (path) => () => import(path)` closes over the path, and a closed-over value is not part of the source, so every module it builds stringifies the same. These two were found to load DIFFERENT modules under one key, so the second has been given a key of its own and now renders what it asked for. What that costs is the shared cache entry — a loading frame the second time, since the module system still dedupes the fetch itself. Pass `cacheKey` to get it back: `<AsyncLoad cacheKey=\"./Dashboard\" lazy={make('./Dashboard')} … />`. A route table that builds its lazies from a list is the usual way to meet this.",
  },
  RMD050: {
    // warning: the member ends up right either way, so nothing downstream is wrong. What is wrong is the
    // belief that the second decorator was doing something.
    duplicate: { decorators: ["state", "compute", "persist", "memoized"], effect: "redundant" },
    severity: "warning",
    title: "A decorator whose effect this member already has",
    fix: "Either the same decorator is on this member twice, or two decorators give it the same thing — `@state` already puts a field in the hydration blob, so `@persist` beside it adds nothing. Delete the one that adds nothing. This is not about two decorators that do different work on one member: `@created` with `@mounted`, `@onWindow` with `@onDocument`, `@watchProp` with `@updated` all run twice on purpose and are silent.",
  },
  RMD051: {
    severity: "warning",
    title: "A list row cannot be told apart from its siblings",
    fix: "A list identifies a row by what sets it apart from the others, so that a row replaced by fresh objects — a refetch, a `JSON.parse` — is recognised as the row it replaces and updated rather than destroyed and rebuilt. This row carries nothing that could do that: every field it has is either nested (compared, never counted) or a value its siblings share, like a `done: false` on all of them. It will be rebuilt whenever the data is replaced, and any state its component was holding goes with it — a half-typed input, an open menu, a scroll position. Give the row a field that is its own, such as an id; or, when only your app knows which row is which, say so where the data arrives: `this.rows = merge(this.rows, incoming, (row) => row.id)`.",
  },
  RMD052: {
    severity: "error",
    title: "A component among JSX children, where an element was meant",
    fix: "`{Panel}` names the component instead of rendering it — write `<Panel />`. A class is a function rather than a vnode, so it is dropped and the page comes up without it, and until now nothing said so: the check beside this one looks for an OBJECT among children, and a function never reaches it. Handing a component to something else is an attribute — `<Slot view={Panel} />` — and that is a prop, not a child.",
  },
  RMD053: {
    // error, not warning: the read returned nothing, so whatever it was for is missing from the page.
    severity: "error",
    title: "The request was read with no request scope installed",
    fix: "`requestContext()` is live only while the page is being rendered — on the server that is the SYNCHRONOUS section, and the scope is cleared before the render's first `await`, so a read below one arrives here. Read it in `render()`, in `@created`, or above the first `await` of an async lifecycle method, and keep what you need in `@state`. Holding the object does not help: every member of it is a getter over the current request, so `const ctx = requestContext()` above an `await` and `ctx.get(key)` below it is the same late read. The other way to arrive here is calling it at module top level, before any render has started. This is reported as well as thrown because the throw does not always arrive anywhere: inside an async `@mounted` it goes into the server drain and is swallowed, and the page is served, complete and quietly missing this value.",
  },
  RMD058: {
    // warning, not error: the page renders and every value is simply missing, which is the same
    // stance RMD036 takes for the state blob. Taking a page down over a blob is the worse failure.
    severity: "warning",
    title: "The request blob could not be read",
    fix: "The server stamps the values a page opted into onto the root element, and `hydrateRoot` reads them back. This one did not parse, so NOTHING was restored — every `requestContext().get(key)` on the client answers `undefined`, including keys that were exposed correctly. What you will see beside this is misleading on its own: `RMD025` says a key was not exposed, which is not what happened, and `RMD007` reports the render mismatch that follows and sends you looking for a clock. This is the report that says what actually went wrong. The blob is JSON on the root element; something between the server writing it and the browser parsing it altered it — an HTML transform, a proxy rewriting the markup, or a value that could not be serialized cleanly.",
  },
  RMD059: {
    // warning: the page is fine and the failure is the app's own, in its own method. What was
    // wrong was that nothing said the method had failed at all.
    severity: "warning",
    title: "An async lifecycle rejected",
    fix: "An `async` `@created`, `@mounted` or `@destroyed` that rejects is NOT caught by an error boundary, and that is deliberate: the rejection arrives at an arbitrary later moment, when the page is already interactive and there is no render left to fail — replacing it with a fallback then is the worse outcome. So the page keeps running and this says what happened, which is the part that used to be missing. Handle it where it happens: wrap the body in `try`/`catch` and put the failure in `@state` — an `error` field the render can show — which is also the only way to tell the reader anything. If the work must take the page down, re-throw from `render()` rather than from the lifecycle, because that IS a render and a boundary can see it. `ramonda-check` reports the same method before it ships, as `unguarded-async-lifecycle`.",
  },
  RMD062: {
    // An error: the element carries the class and none of the custom properties the rule reads, so
    // every declaration that uses one falls back. The page is wrong, not merely slower.
    severity: "error",
    title: "A style block was applied with no values for its holes",
    fix: "A compiled block with holes is a FUNCTION — `css={_s0(width)}` — and reading it without calling it, `css={_s0}`, hands the element every property name and no value for any of them. Measured, the element then renders with the class and no custom properties at all, and every declaration in the rule that reads one falls back to its initial value; nothing else says so. The compiler never writes that, so what reaches here is hand-written code or a wrapper: call the descriptor with one argument per `{{ … }}` in the block, in the order they were written. A block with NO holes is a value already and is passed as it is.",
  },
  RMD063: {
    // An error: one declaration is missing from the element, so it renders unstyled in that respect.
    severity: "error",
    title: "A style block's value was refused",
    fix: "A `{{ … }}` hole becomes one CSS custom property, and a custom property's value may not contain a `;` — that character is what separates declarations, so a value carrying one would become a SECOND declaration on the element. Measured through a server render and back: a value like `red; position: fixed; width: 100vw` came out of the round trip as real, applied declarations, on a page nothing else would have refused. So the value is not written at all and the declaration is dropped, which is the right way round — a missing border beats a full-viewport overlay somebody's record asked for. The value came from an expression, so fix it where the expression reads its data rather than here.",
  },
  RMD064: {
    // An error, and it used to be worse than one: the render threw.
    severity: "error",
    title: "A `css` value is not a compiled style block",
    fix: "The `css` prop takes what the compiler produced — a value with a `className` and a `properties` and `values` array beside it — and the types refuse anything else, so what reaches the runtime came from JavaScript that was not checked: a hand-written object, or another library's own shape. It is ignored, and the element renders unstyled rather than taking the render down, which is what it used to do: measured, a plain object threw `Cannot read properties of undefined (reading 'length')` and named nothing about `css`. Write the block as `css=@( … )`, or `css={@( … )}`, and let the transform produce the value; if the value comes from a wrapper, `toStyleObject` from `@ramonda/css` is the adapter that turns one into `{ className, style }`.",
  },
  RMD061: {
    // A warning: the page is not wrong, it costs a render it did not need and loses a ref the author
    // meant to keep. An error in a later version, the standing rule for a new code.
    severity: "warning",
    title: "A ref was built while a value was being derived",
    fix: "`createRef()` returns a NEW object every call, and a ref is an identity — so one built inside a render, a `@compute`, a `@memoized` member or a hook's props callback is a different ref every time. Two things follow. The child is handed a changed `ref` on every parent render, which IS a props change (`ref` is compared like any other prop), so it re-renders for nothing. And the ref the author meant to read is replaced before they can read it — nothing kept a reference to it. Put it on a FIELD: `private field = createRef<HTMLInputElement>()`, and write `ref={this.field}` in the render. A callback belongs there too — `createRef<T>((node) => this.arrived(node))` on a field is how `Select` and `TextArea` learn their element has appeared.",
  },
  RMD060: {
    // error: nothing renders. The component's output is a promise, so the diff is handed an object
    // that is not markup and throws from inside itself, naming neither the component nor `render`.
    severity: "error",
    title: "render() is async",
    fix: "`render()` must return markup, not a promise for it. An `async render()` returns a `Promise` the moment it is called, so the diff is handed an object that is not a node — and what you see is a `TypeError` from inside the framework naming neither your component nor `render`. The type system refuses this, so reaching it means a cast, a `@ts-ignore`, or a loosened base class somewhere above. Load the data outside the render: `@mounted` (or `@created`) writing the result into `@state`, and a render that shows what state it is in; or `AsyncLoad`, which takes the promise and renders a fallback while it settles. `ramonda-check` reports the same method before it ships, as `async-render`.",
  },
  RMD055: {
    severity: "error",
    title: "A hook's props passed as a plain object",
    fix: "Pass a callback instead: `this.use(Hook, () => ({ ... }))`. An object literal in a field initializer is evaluated ONCE, while the owner is being constructed, so every value in it is frozen at that moment — a later `this.count` never reaches the hook, and nothing reports the stale value. A callback that reads no signal costs nothing: it runs once, at mount, and never again, and the inline functions in it keep their identity. (A development build calls it again to check it, and keeps nothing from those calls.)",
  },
  RMD056: {
    // An error, and it THROWS in every build — see the Provider in `base/Context.ts`. The prose here
    // is what development prints beside the throw.
    severity: "error",
    title: "One context provided twice by the same component",
    fix: "A component publishes a context on ONE object, so the second Provider replaces the first and every descendant reads the second whichever part of the tree it is in — while the component itself can still read both through its own hooks, which is what makes the mistake invisible from the one place that made it. Put each Provider on its own component and give it the subtree it is for: a component that renders `this.props.children` scopes the context to what is inside it, so two of them side by side are two independent scopes and a consumer in each finds its own with nothing passed down. If the two values are for different purposes, they are two contexts — call createContext twice. Splitting the keys between two Providers is not a way out: a Provider takes its options whole, so the second replaces the channel and the first half falls back to the default. `single` does not cover this and is a different question — it says whether NESTING is a fault, and a context that welcomes nesting is still broken by two on one component.",
  },
  RMD057: {
    // A WARNING rather than an error, and the reason is what the check can prove. This arrangement
    // has one legitimate reading — read the value from above and provide a derived one below, which
    // only works in this order — and one mistake, a consumer meant to read this component's own
    // value that was written a line too early. Nothing here can tell them apart, so it says what it
    // found rather than raising the panel's alert. The other order is not reported at all: a
    // component that provides and then uses its own value is `QueryClientProvider` followed by
    // `Query`, which is the arrangement the packages are built around.
    severity: "warning",
    title: "A context consumed above the provider on the same component",
    fix: "A consumer resolves its channel ONCE, when it is constructed, and hooks are constructed in field-declaration order — so this consumer looked before the provider on its own component existed, and reads the nearest provider on an ANCESTOR instead (or the context's default, if there is none). If this component's own value was meant, the provider has to be declared first, or read it through the provider hook itself — `this.theme.color`, where `theme` is the Provider, which always means this component's value and does not depend on the order. If the value from above was meant — reading the outer theme to derive an inner one — then this is that arrangement working, and the order it needs is the one it has.",
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

  /**
   * The record, for a collector that asked for one — a devtools panel, a test, a log shipper.
   *
   * The console line above is unchanged and still the default: this adds a consumer rather than
   * replacing one. `severity` is translated because the protocol's word is `warn` while this
   * package has always said `warning`, and the vocabulary belongs to the protocol.
   */
  globalThis.__RAMONDA_DIAGNOSTICS__?.({
    code,
    scope: "ramonda/core",
    severity: spec.severity === "warning" ? "warn" : "error",
    message: detail === undefined ? spec.title : `${spec.title}: ${detail}`,
    fix: spec.fix,
    data: reportable(data),
    time: Date.now(),
    dedupKey: id,
  });

  ramondaLog(spec.severity, message, data);
}

/**
 * The part of a diagnostic's `data` a record may carry: values, never live objects.
 *
 * `data` here is `unknown` and always has been, because it goes to a console — where an object is
 * the useful thing, expandable and inspectable. A record is different: a collector keeps a bounded
 * history, so anything live in one stays alive for as long as that history does. `propsStability`
 * passes `{ cached, fresh }`, which are the actual prop values — a component, a DOM node and an
 * array of them are all ordinary things to find there.
 *
 * So the console keeps the whole object and the record keeps the primitives, and the filter is here
 * rather than trusted to call sites: there are thirty-nine of them and `unknown` promises nothing.
 *
 * ## Two things it refuses to do, both because reporting must not become the fault
 *
 * **It never invokes a getter.** `Object.entries` would, and a getter is arbitrary code: it can throw
 * — taking the app down from inside the diagnostic that was explaining what was wrong with it — or
 * write state, which lands mid-render and raises RMD001 attributed to whoever was rendering. Every
 * call site today passes a fresh literal, so this is unreachable from any of them; it is written this
 * way because the argument is `unknown` and the next call site is not required to be one of those. A
 * computed value is not "what the message interpolated" in any case.
 *
 * **A `bigint` becomes its digits.** It is a value, so the rules above admit it, and it is the one
 * primitive `JSON.stringify` throws on — which every collector that ships a record somewhere performs.
 * A prop can be a `bigint` and `propsStability` passes prop values, so this is reachable. Dropping it
 * would delete a value the message names; the string is what the console prints for it anyway.
 */
function reportable(data: unknown): Record<string, unknown> | undefined {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return undefined;

  const values: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    const described = Object.getOwnPropertyDescriptor(data, key);
    if (described === undefined || !("value" in described)) continue;

    const value = described.value;
    if (value !== null && typeof value === "object") continue;
    if (typeof value === "function" || typeof value === "symbol") continue;
    values[key] = typeof value === "bigint" ? String(value) : value;
  }

  return Object.keys(values).length === 0 ? undefined : values;
}
/** Test-only: lets each test observe a diagnostic that a previous one deduped. */
export function resetDiagnostics(): void {
  reported.clear();
}
