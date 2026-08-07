# @ramonda/form

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
  and its `@destroy` called a cleanup that could not exist.

  The description and the cleanup now live in the module that owns the panel — a free function and a
  `WeakMap` keyed by instance — leaving one `if (__DEV__)` line at each end of the class. `@ramonda/form`'s
  production bundle is 529 bytes smaller, and every devtools name is now absent from it.

  No behaviour changes; the panel works exactly as before.

- 4385dec: The QUERY and FORMS tabs find what was already there when the panel loads

  A devtools tab arrives through a dynamic import, so it loads after the app has mounted — and
  anything that announced itself during that mount announced to nobody. `QueryClientProvider`
  announces from `@create`, which runs during hydration, and its provider sits at the root and never
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
