# @ramonda/form

## 0.7.0

### Minor Changes

- b5a2ec5: Every package ships its graph, and a graph describes what a project ships.

  `@ramonda/core`, `@ramonda/router`, `@ramonda/query` and `@ramonda/form` emit their fragment in
  their own build and point at it from `package.json`:

  ```json
  { "ramonda": { "graph": "./dist/graph.json" } }
  ```

  An app that installs them rather than compiling them from source now gets their composition instead
  of a hole. Measured on `apps/playground-core`, which has no `paths` entry for `@ramonda/form`: its
  two unresolved `this.use(Form<typeof schema>)` edges are gone, and four of the package's own nodes —
  `Form`, `Field`, `FormState` and the context the form publishes — are in the app's graph.

  **A graph now describes what a project ships, so test files are left out** — `__tests__/`, `test/`,
  `tests/`, `*.test.*`, `*.spec.*`, judged relative to the directory holding the tsconfig. This is a
  change to what the checks read as well: a class written to be checked is no longer reported. It had
  to happen for a fragment to mean anything. Measured: `@ramonda/query` counted 109 components against
  a real 12, `@ramonda/form` came out as an APP because its tests mount one, and core's fragment
  carried a component from a fixture directory.

  Two more things fell out of emitting fragments for real packages:

  **A root is a `bootstrap` that names a component.** `@ramonda/testing-library` calls `bootstrap` on
  a vnode it is handed — that is its whole job — and a call whose argument nothing can name starts no
  tree. Counting it made every package that maps testing-library in its tsconfig come out as an app.

  **A library's fragment describes itself.** These packages compile their dependencies from source, so
  `@ramonda/router`'s fragment carried `@ramonda/core`'s classes too — the same nodes, under the same
  ids, that core's own fragment declares. An app splices one fragment per package and gets each once;
  an edge pointing into another package still resolves, because the id is the same on both sides.

  Across this repository's four apps the graph is now complete but for two edges, and both are
  deliberate demonstrations of a failed load.

## 0.6.0

### Minor Changes

- bf0092e: `FormState` — a component that watches the form rather than a field

  ```tsx
  class SaveButton extends Component {
    private form = this.use(FormState);

    render() {
      return (
        <button disabled={!this.form.isValid || this.form.isSubmitting}>
          {this.form.isSubmitting ? "Saving…" : "Save"}
        </button>
      );
    }
  }
  ```

  **No props, at any depth.** The form publishes itself on the context — a provider mounted from inside
  the hook, which is how `Router` carries its route state, and the only route available since
  `GLOBAL_RUNTIME` is internal to `@ramonda/core`. Two forms nested behave the way you would want without
  saying anything, because contexts are prototype-chained per component: a button watches the nearest form
  above it. With no form above at all, every fact reads as its default and core reports RMD003 when the
  component mounts, so this package writes no diagnostic of its own.

  **It wakes on an answer that MOVED, not on an event.** A form invalid before a keystroke and invalid
  after it has not changed its answer, so the button sleeps through the typing and wakes the moment
  validity flips or a submit starts or ends. The form keeps the facts as last published and compares —
  which is precisely what a form-wide counter cannot do. `isDirty` is the expensive one, a comparison of
  the whole value against the baseline, and it is computed only while something reads it; that is
  asserted.

  `isValid` · `isDirty` · `isSubmitting` · `submitCount` · `formErrors` · `submit(event?)` · `reset()`.
  `submit` is here so a button outside the `<form>` element can submit it without a handler passed down.

  ### Which completes the recipe for a big form

  With the fields watched by their own components and the form-level facts by this one, the owner reads
  **nothing** — so its render can be a `@compute` that is built once for the life of the form:

  ```tsx
  @compute get body() {
    return (
      <form onSubmit={this.form.submit}>
        <Rows of={this.form.fields.contacts} />
        <SaveButton />
      </form>
    );
  }

  render() {
    return this.body;
  }
  ```

  Reaching `this.form.fields.contacts` is navigation through a proxy, not a read, so the compute depends
  on nothing. The owner is still woken on every change — `@state` on a hook holds its rebuild and it
  cannot opt out — but it hands the diff back the same tree and the diff stops there.

  Measured at 300 rows, one keystroke: **45 ms** with no per-field subscription, **1.9 ms** with each row
  watching its own field, **0.65 ms** with the container watching the array, **0.48 ms** with the body
  cached. The last step is small only because that owner's render is two vnodes — for a render building
  300 children inline it is 4.35 ms against 0.19 ms.

- ea07a10: Four defects, each one measured before and after

  **A validation that rejects no longer wedges the form.** Standard Schema says `validate` answers with
  a result or a promise of one; it does not say the promise resolves, and an async rule doing real
  work — a uniqueness lookup against a server — rejects the moment the network does. Nothing gave that
  promise a rejection handler, so it surfaced as an unhandled rejection, and `isSubmitting` was never
  released: one failed lookup disabled the submit button for the life of the page. It is now reported
  as **`RMF004`**, the messages already held are kept, `isValid` goes false — "we asked and did not
  hear back" is not "nothing failed" — and the button comes back.

  **A date field no longer loses a day.** `bind` formatted with `toISOString()`, which is UTC: 01:00
  on the 7th in Belgrade showed as the 6th, and picking that same shown day wrote the 6th back, so the
  reader's date moved by being looked at. Both directions are local now, and the time a value already
  held is carried across a change of day — a date input cannot express one, so throwing it away moved
  an appointment to midnight. Asserted at two times of day, which is what catches the fault on both
  sides of Greenwich; verified in UTC, +5:30, +14 and −11.

  **An emptied number input is still a number input.** `fromControl` writes `""` for a cleared number
  field on purpose, so a schema can report on it instead of `NaN` poisoning arithmetic — but `bind`
  read the control's kind off the value's runtime type, so `type: "number"` vanished with the first
  backspace, the element reverted to text, and every later read wrote a string. The field never became
  numeric again: the spinner gone, and on a phone the numeric keyboard gone mid-entry. A present value
  decides the control and is remembered; an absent one keeps what the field was. The same fix covers a
  cleared date.

  **`reset(record)` no longer reports a dirty form.** `reset` moves the baseline to the values it is
  handed — "nothing in a form that was just reset is the user's" — but `dirty` compared against
  `defaultValues`, so the most ordinary flow there is, fetch the record then `form.reset(record)`,
  marked every field as edited: the unsaved-changes guard fired on the way out and Save came up
  enabled. One baseline now answers every "has the user changed this".

  And a `Date` is compared by the moment it names. A defaults factory writing `when: new Date(iso)`
  builds a fresh object per run, which used to replace the field, drop the messages under it and
  re-run the whole schema on every render of the owner, for a value that had not moved.

- df0240e: `Field` — a field in its own component, which until now could not work

  ```tsx
  @Host("label", (self: TextField) => ({
    className: self.f.error ? "field field--invalid" : "field",
  }))
  class TextField extends Component<{ of: FieldNode<string>; label: string }> {
    f = this.use(Field<string>, () => ({ of: this.props.of }));

    render() {
      return [
        <span className="field__label">{this.props.label}</span>,
        <input {...this.f.bind} />,
        this.f.error,
      ];
    }
  }

  <TextField of={f.email} label="E-mail" />;
  ```

  **It is a correctness fix before it is anything else.** A component handed a field node and reading
  it directly re-rendered NEVER, and said nothing about it: a field node is one cached object for the
  life of the form — deliberately, because a fresh one per access means a fresh `bind.onInput` per
  access and RMD020 reports that — so the component's props never changed and the diff skipped it. Its
  message never appeared, and a write from anywhere else never reached its input. Both measured. So
  every styled input, every shared field component and every row of a list needs this hook.

  **And it makes an edit surgical.** The subscription is per path, so a keystroke wakes the fields that
  changed and no others: its own path, its ancestors — an aggregate moves when a leaf below it does —
  and its descendants, for a whole record landing above. Messages wake only the fields whose messages
  moved, so a cross-field rule stays correct, because the schema still re-answers the whole form.

  Measured over 300 rows through `list()`, one keystroke: **every row rebuilt, 45 ms** before; **one
  row** after. The granularity was always in the list engine — one tracker per item — and the form's
  single shared counter flattened it.

  `Field` answers everything a node's `$` does, so a component written against `FieldApi<T>` has
  nothing new to learn. Name the type at the `use` — `Field<string>` — because `FieldNode<T>` is a
  conditional type and `T` cannot be recovered from it by inference; the same pin `Query<Todo>` takes.

  A form written inline in one component is unchanged: reaching into `form.fields` is asking about the
  form, and that subscription still wakes the owner on everything.

  Two smaller things fall out of it. `rows` hands back the same row object for a row that has not moved,
  instead of rebuilding every one whenever the array's contents change — a fresh object is a changed
  `item` prop, which is what re-rendered all three hundred. And its cache compares row ids by content:
  `rowIds` returns the array it keeps and tops up in place, so comparing the reference was comparing a
  list against itself.

- 722a6b4: A watcher hears only about WHAT it reads, not merely where

  `Field` records which of its members a component actually read, and a poke about anything else is
  ignored. The case it exists for is a list: a component rendering `rows` shows each row's `id`, `index`
  and `field`, and none of them move when a value inside a row does — so it now **sleeps through a
  keystroke** in any of its rows, and each row wakes on its own.

  Which makes the container worth watching too:

  ```tsx
  class Rows extends Component<{ of: FieldNode<Contact[]> }> {
    f = this.use(Field<Contact[]>, () => ({ of: this.props.of }));

    render() {
      return (
        <div>{list({ each: this.f.rows, key: (row) => row.id, as: Line })}</div>
      );
    }
  }
  ```

  Measured at 300 rows, one keystroke: **45 ms and every row rebuilt** with no per-field subscription,
  **1.9 ms and one row** once each row watched its own field, **0.6 ms** with the container watching the
  array as well — because then the three hundred list items are never diffed.

  Four kinds of change, as a bitmask rather than a set of strings, since a wake happens per keystroke and
  the test is a single `&`: a value moved, a touch or edit mark changed, the messages changed, or an
  array changed length or order. `error` reads two of them — a message is held back until the field has
  been touched, so a blur reveals one without any message having moved, and that is asserted.

  The mask is never cleared, and that is what makes it sound rather than sloppy: reading a member for the
  first time takes a render, and that render came from something already subscribed or from the
  component's own state — so a member not in the mask cannot be affecting what is on screen.

  Two corrections that came out of measuring it:

  **`rows` and the array members are typed from the element now.** `Field<Contact[]>` answers
  `Row<Contact>[]`, so `list({ each: f.rows, as: Line })` type-checks against a component taking
  `Row<Contact>`; it was `Row<unknown>` and every call site needed a cast. `append` and `insert` take a
  `Contact`, and `at(key)` answers the child's own type.

  **And the docs were wrong about why the owner re-renders.** It is not "because it read `form.fields`" —
  `@state` on a hook holds the owning component's rebuild from the moment the signal is built, whatever
  that component goes on to read, so the owner wakes on every change and cannot opt out. What the read of
  `version` inside the form actually reaches is a `@compute` deriving from a field and a `list()` item,
  which are the two scopes that record a dependency.

### Patch Changes

- b34759e: Hydration: a form that arrived as markup had never validated

  `@created` defaults to `env: "shared"`, and core **skips a shared create during hydration** — on
  purpose, because it already ran on the server. The model behind that is sound: whatever the create did
  is captured in the hydration blob. A form's values, messages and `validated` are plain fields rather
  than `@state`, deliberately, because a form holds whatever the schema's input side is — so none of it
  survives to the client, and nothing had ever validated there.

  Measured: a form whose defaults PASS sent `<button disabled={false}>` from the server, and hydration
  turned the button off, with nothing able to turn it back on until the reader edited a field. The exact
  failure the priming validation exists to prevent, arriving by the one path nothing had tested.

  Fixed with a client-only `@created` that primes if the shared one did not run on this side, which also
  restores the devtools announcement for a hydrated form.

  **`FormState` had the same hole**, and this is why it now registers on its first READ rather than from
  `@created`: a read happens in the render, on whichever side is rendering, so there is nothing to skip.
  It re-registers whenever the set of facts it watches grows, which keeps the form's record of "the
  answers as last published" comparing against the truth rather than a default.

  The SSR cost of watching is written down rather than left to be discovered: every watched component
  ships `{"version":0}` in the blob, because the subscription is a `@state` counter and `@state` means
  "serialize me". Always zero on the server, and restoring zero is a no-op — around 17 KB of markup at
  300 rows that buys nothing. The fix belongs in core, where a `@state` still holding its initial value
  could be left out of the blob entirely.

  And `NO_MESSAGES` is one frozen value in `validate.ts` now, beside `NO_ISSUES`, instead of a copy per
  module. Sharing it is what keeps a render stable — a fresh `[]` per read is a new identity, which is
  what RMD020 reports — and freezing it means a caller who pushes into what they were given hears about
  it instead of adding a message to every field on the page.

- 6a18554: The field tree lets go of rows the array no longer has, and `announce` is private

  A field node is created once and handed back for the life of the form, deliberately: a fresh one per
  access is a fresh `bind.onInput` per access, which RMD020 reports and which really does re-attach the
  listener on every render. But "for the life of the form" was also true of a row that had been
  **removed** — so a form that once showed ten thousand rows went on holding a node and a handle for every
  one of them, each handle carrying two bound closures and a row cache.

  Measured on a form grown to 5000 rows of two fields: **15002 nodes and 10001 handles** retained, and
  still retained after the array shrank back. Now a shrink drops the nodes and handles for the rows past
  the new length, in both trees — 200 rows shrunk to 3 goes from 402 nodes to 8.

  Safe because the rows are gone: a caller still holding the node for row 6000 of a three-row array is
  holding a row that does not exist, and the next row to appear at that index is a different row that
  should get a different node. Asserted from both sides — the rows that survive a removal keep the exact
  identity they had, and a row appearing where a removed one sat is not the old node.

  The heap figure is deliberately absent: `global.gc` is not exposed in this harness, so a before-and-after
  of `heapUsed` measures when the collector happened to run. The object counts are what is measurable, and
  they are what the test asserts.

  `Form.announce` is `private` now, which is what it always meant — methods are bound whether or not
  TypeScript can see them, so it still works as the listener it is registered as, and a hook method that is
  not `private` is public API somebody could have called to dispatch a form announcement of their own.

- 6a8c2e8: The two bookkeeping walks, measured and made cheaper

  Neither is on a keystroke, which is why they were not what `Field` addressed — but both are paid on
  ordinary interactions, and both were spending most of their time rebuilding strings.

  **`forgetUnder`, which every array operation runs through: 424 µs → 42 µs** over a form of 1208
  recorded paths. The coverage test took a `Path` and so rebuilt `pathKey(path)` and `keyPrefix(path)`
  for _every key it was asked about_; it is now built once per call. The issues map is copied only if
  something is actually dropped, and the touch sets no longer copy every key to delete a few.

  **`touchAll`, once per submit: 884 µs → 261 µs** over 1208 paths. It built a fresh `[...path, key]`
  array per node and ran `pathKey` over it; the key is now carried down from the parent, and
  `Object.keys` replaces `Object.entries`, which was allocating a pair array per node. What is left is a
  concatenation and a `Set.add` per path.

  `childKey` sits beside `pathKey` in `path.ts` so the two spellings of one key format cannot drift, and
  a test asserts they agree — including for an index, a property name containing the characters the
  readable form uses, and the empty-string property name that shares the root's key.

  Also covered for the first time: `forgetUnder` over the ROOT, which is a form whose whole value is an
  array. Its own mark must survive an operation on itself while every mark beneath it goes, and nothing
  had ever asked.

## 0.5.1

### Patch Changes

- 78c79ef: `@watchProp` takes several selectors and runs once when any of them changed

  ```tsx
  @watchProp((p) => p.page, (p) => p.term, (p) => p.sort)
  reload(next: [number, string, string], previous: [number, string, string]) { … }
  ```

  **"Run this when any of these props changed" was previously unwritable.** Stacking the decorator makes a
  separate entry per selector, so the method runs once per CHANGED prop — twice when two moved in the same
  update. And selecting a tuple from one selector is worse: comparison is `Object.is`, so a fresh array is
  never equal to the last one, and the method fires on **every** props change with `previous` and `next`
  holding identical contents. Both measured; both are now covered by tests.

  Comparison stays `Object.is` per selector, so nothing is compared deeply and the cost is unchanged. Only
  the CALL is coalesced. A selector whose value did not change keeps it in both arrays, so
  `previous[i] === next[i]` is how the method tells which one moved.

  **Breaking: the values are always a tuple, including for one selector.** `(next: string)` becomes
  `([next]: [string])` — destructuring in the parameter list leaves every method body untouched.

  That is about evolution rather than neatness. With a scalar for one selector and a tuple for several,
  adding a second selector to a watcher that already exists silently changes the method's parameter type,
  and what a decorator reports for that is `TS1241 Unable to resolve signature of method decorator`, which
  names nothing useful. A tuple that grows leaves `next[0]` meaning what it always meant.

  **Two of this package's own call sites were silently wrong after the change and the compiler accepted
  both**, which is worth knowing if you have your own: a parameter typed as a deferred conditional
  (`InferIn<S>` in `@ramonda/form`) or as anything array-shaped (`QueryKey` in `@ramonda/query`, which is
  `readonly unknown[]`, so a one-tuple is assignable to it) type-checks and then receives the tuple.
  `@ramonda/form`'s late-defaults suite caught it; the types did not. Audit by shape, not by `tsc`.

## 0.5.0

### Minor Changes

- f4e0b66: `RMF001`, `RMF002` and `RMF003` are records, and the two refusals stay refusals

  All three now reach [the collector every reporting package shares](https://ramonda.pages.dev/reference/diagnostics#capturing-them),
  so a devtools panel shows them and `installDiagnostics` can take them elsewhere.

  **Two of the three are not diagnostics, and the port keeps that straight.** Assigning to a field and
  asking a non-list field for its rows **throw**, in every build, because there is no correct program in
  which either does something. For those, development adds the record and nothing else: printing as well
  would make development noisier than production for a fault whose message is already in front of the
  reader. `RMF003` is the opposite — nothing throws, the form has let go of the failure, and the console
  line is the only trace, so it prints.

  The thrown messages name the package now, `[Ramonda form RMF001] …`, and the sentence itself is
  unchanged. Both still throw with `__DEV__` false, which the production suite asserts.

  `RMF003` keeps handing the console the **Error object** and not just its message, because a console
  given the Error prints a stack a reader can click. That object deliberately does not enter the record:
  a collector keeps a bounded history, and an Error holds its stack, which holds the scope it was thrown
  from — one of those in a vault keeps a whole submit alive. The record carries the message as text
  instead. An existing test caught that distinction being flattened during the port, which is why it is
  now written down where the code is.

- cf9be97: The FORMS tab names a form from its `use()` metadata

  ```tsx
  private signup = this.use(Form<typeof schema>, { schema, defaultValues, onSubmit }, { label: "Sign Up" });
  ```

  The tab and the component tree then call it **`Form (Sign Up)`** instead of `Form 2`. Which mattered as
  soon as the tab started grouping: a header reading `Form 2` frames a form's broken fields correctly and
  still does not say which form it is, and the number is only the order it mounted in.

  Read off the instance under `Symbol.for("ramonda.hook.meta")` — a documented key, no import, and no
  payload on the announce event. That event fires once at mount while every other field in this tab is
  read live, and a name taken from it would have been one frozen field among current ones.

  Unlabelled forms keep the number, so a page with one form is unchanged.

### Patch Changes

- 863983a: The FORMS tab says which form a broken field belongs to

  A form's row is followed by one row per field that is wrong, and those rows were **siblings** of the
  summary rather than visibly inside it. With one form on the page that reads fine. With two, the second
  form's `email` row sits directly under the first form's fields and reads as if it belonged to them —
  there was nothing on screen tying a field to its form.

  The rows were grouped in the data all along, one group per form; the group simply had no label, so the
  panel had nothing to draw. It has one now, and only when there is more than one form — the same rule
  `@ramonda/query` uses for its client label, because a header over the only group says nothing the row
  beneath it does not.

  Two tests, one on each side of the contract: that a second form gets its own labelled group whose label
  names the form in its summary row, and — in `@ramonda/devtools` — that a labelled group is actually
  drawn as a header above its own rows, in order. Nothing asserted the second half before, so the label
  could have been ignored by the panel and the fix would have looked done.

  Still open, and it needs a decision rather than code: a form is called `Form 1`, `Form 2`, because a
  hook cannot see the component that used it. Core keeps the owner on its runtime for exactly this kind of
  naming, but not as public API — so `SIGNUP` instead of `FORM 2` is a question about core's surface, not
  about this tab.

## 0.4.0

### Minor Changes

- e06dd85: A devtools tab is its own entry, and a package only announces

  ```ts
  if (import.meta.env.DEV) {
    void import("@ramonda/devtools");
    void import("@ramonda/query/devtools");
    void import("@ramonda/form/devtools");
  }
  ```

  Each tab now lives behind `/devtools` on its package, and importing that entry registers it.
  `create-ramonda` writes these lines for the add-ons you pick.

  **Why it moved.** A package that imports the module describing its tab puts that description into
  the bundle of every application using the package — `__DEV__` strips it from production, but not
  from development. Measured: 12.4 KB of query and 5.2 KB of form were in the development bundle of
  every app, whether or not anyone ever opened the panel. Both are now only in the bundle of an app
  that asked for a tab.

  **How a package reaches its tab instead.** An event. `QueryClientProvider` and `Form` announce
  themselves arriving and leaving with one `__DEV__`-guarded line each, and the entry listens and
  keeps whatever list it needs. Nothing about a panel lives on the class — no field, no method, both
  of which ship whatever the guard says — and the package does not know whether anybody is listening.

  That is the shape core already uses for `ramonda:tick` and `ramonda:dev-log`.

  Nothing changes for an app beyond the import lines: both tabs look and behave as before.

### Patch Changes

- e06dd85: Devtools registration no longer costs a production build

  Registering a panel used to leave a method and a field on the class, and neither can be tree-shaken:
  esbuild cannot prove a method is never reached dynamically, and a declared field is emitted on every
  instance. So every form in a production app carried ~500 bytes of dead code and a per-instance slot,
  and its `@destroyed` called a cleanup that could not exist.

  The description and the cleanup now live in the module that owns the panel — a free function and a
  `WeakMap` keyed by instance — leaving one `if (__DEV__)` line at each end of the class. `@ramonda/form`'s
  production bundle is 529 bytes smaller, and every devtools name is now absent from it.

  No behaviour changes; the panel works exactly as before.

- 4385dec: The QUERY and FORMS tabs find what was already there when the panel loads

  A devtools tab arrives through a dynamic import, so it loads after the app has mounted — and
  anything that announced itself during that mount announced to nobody. `QueryClientProvider`
  announces from `@created`, which runs during hydration, and its provider sits at the root and never
  mounts again: the QUERY tab was empty for the life of the page. `Form` had the same fault and only
  looked fine because a form usually mounts on a later route.

  Both now answer a request as well as announcing once, and both entries ask on load. The SSR
  playground's smoke test asserts the QUERY tab knows of a client, and fails with the reason if either
  half goes away.

## 0.3.0

### Minor Changes

- 4384f18: Devtools takes plugins, and Query and Forms are the first two

  **A package can register a tab.** `@ramonda/devtools` exports `panelRegistry()`, and anything that
  registers a description gets a tab built for it. The description is DATA, never markup: a row has a
  title, a status, typed fields, an optional value and its actions, and the panel decides what all of
  that looks like. That keeps the tool the app is diagnosed with out of the app's hands, keeps its
  look coherent, and keeps the contract small enough to version honestly. See
  [Adding a tab](https://ramonda.pages.dev/devtools/panels).

  ```ts
  const off = panelRegistry().register({
    version: 1,
    id: "sockets",
    label: "SOCKETS",
    snapshot: () => ({
      groups: [
        {
          rows: [
            {
              id: "ws-1",
              title: "wss://api.example.com",
              status: "ok",
              fields: [
                { kind: "live", id: "age", text: "last message 4s ago" },
              ],
              value: { data: lastFrame, revision: frameCount },
              actions: [{ id: "close", label: "close" }],
            },
          ],
        },
      ],
    }),
    run: (rowId, actionId) => undefined,
  });
  ```

  Register from an instance's lifecycle rather than at module import, so the list is exactly the live
  sources. A field marked `live` — a clock, a countdown — keeps its own text node while the rest of
  the list holds still, which is what stops a tab rewriting itself twice a second.

  **`@ramonda/form` has a Forms tab.** Every mounted form, whether it is valid, how many fields are
  blurred and edited, and a row per field that is actually wrong — with whether that field has been
  interacted with at all, which is the answer to "it says this is required and I have not touched it".
  `reset` and `submit` go through the form, so submit is the real one, validation and `onSubmit`
  included. The values are read-only: a form holds the schema's input side, and a `Date` does not
  survive being typed back as JSON.

  **`@ramonda/query` describes its own tab now.** The panel used to know what a query row looks like:
  which badge means fetching, that `observers: 0` is worth calling out, that a bounded copy must not
  be editable. That is knowledge about a cache, and it lives with the cache. `__RAMONDA_QUERY__` is
  gone — the registry replaced it — and with it the `QueryBridge` / `QueryRow` / `QuerySnapshot`
  types, which existed only to carry a cache to something that knew how to draw it.

  Nothing changes for an app: the Query tab looks and behaves as it did.

  **A removed panel kept calling into the app.** `disconnectedCallback` stopped neither poll timer, so
  a panel taken out of the document went on asking the cache for a snapshot and the profiler for its
  commits — measured at thirteen further calls over five seconds, and still going. Every tab is
  stopped on teardown now.

  `panelRegistry` and the contract's types are the package's first public exports — everything else
  in it is the panel's own implementation, imported for its side effect.

  **Internal: the panel splits into modules.** `index.ts` goes 2777 → 765 lines; what is left is the
  frame — docking, dragging, tabs, logs. The component tree, the value viewer, the profiler and the
  plugin renderer are their own files.

## 0.2.0

### Minor Changes

- b18658b: `defaultValues` may arrive after the form exists

  "Fetch the record, then fill the form" did not work at all. `defaultValues` was read once, on the
  form's first look at its own values, and never consulted again — so a form handed `{ name: "Ada" }` a
  moment after mounting went on showing the empty strings it started with, and nothing reported it.

  Move the prop now and the form follows, by the rule anyone asking for this wants:

  - a field the user has **not** edited takes the new value
  - a field the user **has** edited keeps what was typed

  Losing what somebody is halfway through typing because a request came back is the failure worth
  designing against; leaving an untouched field empty is the other one. React Hook Form arrives at the
  same place as `values` + `keepDirtyValues`.

  "Edited" is not "visited": `touched` means blurred, and tabbing through a field without typing in it
  leaves nothing of yours to protect. A `reset()` — of the form or of one field — hands everything back,
  so a form you have reset is open to the next set of defaults again.

  **Array fields merge per row while the length is unchanged**, so one edited row does not hold the rest
  back. Once a count differs the array goes whole: yours if you have added, removed or reordered a row,
  the new one if you have not. Pairing rows by number across a length change would put one row's text
  onto another, which is the failure row identities exist to prevent. Rows that survive keep their ids,
  so a caret and a selection stay where they were.

  The form then revalidates, because `isValid` must describe the values it now holds, and drops the
  messages recorded against the values that were replaced.

  **Nothing happens when the defaults did not really move.** The comparison is by value, so the props
  callback rebuilding the object every render — which is what a props callback does — writes nothing,
  renders nothing, and leaves `values` as the same object. That costs one comparison per render of the
  owner: 2 µs at ten fields, 13–20 µs at a hundred, over three runs.

  One thing to know when you write the callback: hand `defaultValues` an object you already have — what
  the fetch returned, a module constant, a field — rather than building one inline. A rebuilt literal is
  reported as RMD022, and that diagnostic's advice is `stable()`, which is the right answer for most
  props and the wrong one for this one, for the reason below. Holding the object leaves nothing to
  report and nothing to wrap.

  It is the form's own comparison and it is unbounded, which is a choice worth naming: declaring
  `defaultValues` stable would have the framework hold the identity and skip all of this, and the
  framework's comparison stops at five levels and the first fifty items of an array. Past the depth it
  answers "different", which is safe; past the width it answers "equal", which is not. Measured with the
  declaration in place, a record whose only change was row 55 of 60 was silently dropped. Right for a
  cache key, wrong for the values themselves.

  Also fixed, found on the same path: **a submit superseded while an async schema was still out left
  `isSubmitting` true forever.** The superseded verdict is still dropped — it is about values the form
  has moved past — but the button is released. Typing one character during such a submit used to wedge
  the form with no way back. A synchronous schema was never affected, which is why it went unseen.

## 0.1.0

### Minor Changes

- 2d6ef19: `@ramonda/form` — the first release

  Forms as a hook: `this.use(Form<typeof schema>, { schema, defaultValues, onSubmit })`. It adds no
  element, so the `<form>` tag stays yours — with your class names, your `noValidate`, and the freedom
  to put a form inside a `<fieldset>` or a `<tr>` where a wrapper would be invalid HTML.

  - **Validation is Standard Schema v1**, so bguard, zod, valibot and arktype all work as they are,
    with no adapter and no dependency from this package on any of them. `defaultValues` and the values
    handed to `onSubmit` are both typed from the schema, and the input and output sides are kept apart
    — a schema that coerces a string to a number is honoured on both.
  - **Fields are property access, not string paths** — `f.address.street`. A typo is a compile error,
    and renaming a schema field breaks the render instead of quietly reading `undefined`.
  - **The whole field API sits behind one token**: `f.address.street.$.error`. A flat API was tried
    first and `value` collided with an ordinary `contacts: { kind, value }[]`; one collision chance
    instead of eleven, and it measured cheaper on a deep schema.
  - **`bind` is everything a control needs** — `name`, `value`, `onInput`, `onBlur`, `aria-invalid`,
    and the right `type` for what the field holds. The handlers are built once per field, so spreading
    it every render re-attaches nothing.
  - **Array rows carry a generated id**, per array rather than per form, so a row keeps its element,
    its message and its caret across an insert or a remove — and a server render and its hydration
    agree on every `list()` key.
  - **Messages stay hidden until they are ready to be seen**: a field must be blurred, edited, or the
    form submitted. `isValid` always reports the real answer underneath.
  - **Server rendering needs nothing wired up.** `name` and `value` reach the HTML, so the page is a
    real form before any JavaScript runs.
  - **A failed submit puts the caret in the first invalid field**, first in the order on screen rather
    than the order the validator reported. Without it, pressing the button does nothing visible when
    the messages are below the fold — and for someone using a screen reader, no signal at all. Scoped
    to the form the submit came from, so a page with two forms cannot steal focus into the other; a
    disabled control is skipped; a programmatic `submit()` moves nothing, since your code called it and
    your code decides where the reader looks.
  - **`move(from, to)` on an array field** reorders a row and carries its identity with it. `remove`
    then `insert` mints a new id, so the reconciler drops the row's element and builds another, losing
    the caret and the selection — which is exactly what row ids exist to prevent, so the library does
    it rather than every app.

  ### `@ramonda/form/bguard`

  A second entry point for the two things Standard Schema cannot express, because they are not about
  validating a value. bguard is an **optional** peer dependency and the main entry never reaches this
  module, so a form over zod pulls in nothing from it. It imports no `@ramonda/core` either, so it runs
  in a bare Node process with no DOM.

  - **`htmlConstraints(schema)`** derives the HTML validation attributes — `required`, `minlength`,
    `maxlength`, `pattern`, `min`, `max`, and `type` from a format. The schema already says
    `minLength(3)`; writing `minlength={3}` beside it is the same fact twice, and the two drift.
    Answers are cached per path, because RMD020 compares attributes key by key and a fresh object would
    be reported for every input on the page. An exclusive bound is left out rather than reported one
    short, and `uuid` produces nothing, since no `<input type>` means it.
  - **`unknownRefPaths(schema, values)`** finds a cross-field rule that points at nothing.
    `ctx.ref('pasword')` returns `undefined` for ever and the comparison quietly succeeds or quietly
    fails; it is the shape of bug that survives a review because the line reads correctly. It belongs in
    a test. It needs values because a `custom` is opaque — a rule that does not run reads nothing, so it
    cannot be checked, which is stated rather than hidden. `ctx.sibling` is covered too, which is where
    it earns most: its string form is the one the compiler cannot check. One rule is one entry however
    many rows it ran on, with the index shown as `*` — reported per row, a single typo on a fifty-row
    list produced fifty entries.

  `revalidateAll` is **removed** from `FormProps`. It was declared and documented as the escape hatch
  for a form big enough that whole-form revalidation would hurt, and it was never read — an option that
  did nothing, which is worse than one that is missing. It is gone rather than implemented, because the
  case does not exist: measured on a bguard schema with a `custom` per field plus a cross-field rule,
  a whole-form pass costs 3.3 µs at 11 fields, 14.9 µs at 31, 48.3 µs at 101 and 154.8 µs at 301 — a
  three-hundred-field form revalidates in a hundredth of a 60fps frame.

  `pick`-based per-field validation was the original plan for the submodule and is deliberately absent
  for the same reason, plus three hazards it carried: `pick` brings the source's object-level assertions
  along, so a whole-form rule would run against a partial value and invent an issue; it reaches
  top-level keys only; and the dependency graph is discovered by running rules rather than known up
  front. Each shows a wrong or stale message, to save ten microseconds.

  Documentation: [Forms](https://ramonda.pages.dev/forms).

  `create-ramonda` offers it as an add-on, so `npm create ramonda@latest` can scaffold a project with
  it already installed.
