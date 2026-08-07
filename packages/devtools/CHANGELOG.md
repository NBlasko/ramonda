# @ramonda/devtools

## 0.5.1

### Patch Changes

- 4a51868: The `LOGS` tab renders a row whose `data` cannot be JSON

  A diagnostic's `data` reaches that tab exactly as the framework passed it, and for `propsStability`
  that is the real prop values — so anything an application can put in a prop arrives there. Three of
  those defeat `JSON.stringify`, and each one **throws** rather than degrading: a `bigint` ("Do not know
  how to serialize a BigInt"), a cycle, and a getter that throws when read. Out of the log listener that
  is an uncaught exception, so the row never rendered — the panel failing on the report it exists to
  show.

  Measured with a `bigint`, which needs no cooperation from anybody: a `bigint` prop is an ordinary
  thing to write. A `bigint` now reads as `10n` and a cycle as `[circular]`, so the value and the shape
  both survive; a value that cannot be read at all falls back to the row without its data rather than
  taking the row with it.

- 53c5bb8: Core's diagnostics reach the Logs tab once, not twice

  `@ramonda/core` now emits its diagnostics as records, and in DEV it is what dynamically imports this
  package — so this bridge was carrying every core report to the `LOGS` tab a second time, next to the
  one core's own log channel had already put there.

  The bridge skips `scope === "ramonda/core"` for the tab, and only for the tab: a subscriber added
  through `installDiagnostics` still receives everything, which is the entire point of that function.

  This is one line, and it needs its own release: without it, a published devtools alongside the new core
  shows every core diagnostic as two rows.

## 0.5.0

### Minor Changes

- 6362125: Diagnostics from every package land in the Logs tab, `installDiagnostics` shares the channel, and a
  bundler no longer throws the whole package away

  **A bundler was entitled to delete this package, and did.** It declared `"sideEffects": false` while
  its entry registers `<ramonda-devtools>` — so the claim was false, and acting on it is correct
  behaviour. Measured: bundling a bare `import` of the built entry with esbuild produced **0 bytes**. Not
  a missing registration; the whole package, gone, because the package said there was nothing to keep. It
  now declares `"sideEffects": ["./dist/index.js"]`, which is what is true.

  Nothing caught it because nothing bundles this package that way — Vite's dev server does not
  tree-shake, and a production build usually leaves the panel out on purpose. It would have surfaced as
  "the devtools do not appear" in one configuration with nothing to blame. There is now a test that asks
  a real bundler rather than restating the field, with `@ramonda/lens` as its control: lens genuinely has
  no side effects, says so, and must be erased to nothing — otherwise a harness that had stopped
  tree-shaking at all would report this package as correct while proving nothing.

  Audited the rest with the same oracle: `@ramonda/query`, `@ramonda/router`, `@ramonda/form` and
  `@ramonda/lens` do no import-time work, so their `"sideEffects": false` is honest, and `@ramonda/core`
  correctly declares no such field at all — its logger attaches a `ramonda:devtools-ready` listener at
  module scope.

  Importing `@ramonda/devtools` now collects [diagnostic records](https://ramonda.pages.dev/reference/diagnostics#capturing-them)
  from any package that reports them and puts each one in the `LOGS` tab, with its `fix` and the values
  its message named. Nothing to wire up: the same import that registers the panel subscribes the bridge.

  `RML*` from `@ramonda/lens` is the first reporter to arrive this way, and it arrives without
  `@ramonda/lens` depending on this package or the other way round — the contract is a record shape and
  a global sink, not a module.

  **`installDiagnostics(sink)`** is the way for anything else to read the same stream, and it returns the
  uninstall:

  ```tsx
  import { installDiagnostics } from "@ramonda/devtools";

  const stop = installDiagnostics((record) => {
    if (record.severity === "error") myCollector.alert(record);
  });
  ```

  It exists because the sink is one function on `globalThis`, and one function has one owner: assigning
  it — which the reference page shows, so somebody will — replaces whoever was there, normally this
  panel's bridge, and the Logs tab then quietly stops filling. Subscribing shares it. Several
  subscribers, one sink, no ordering to agree on.

  Three failure modes the shape was chosen for, each with a test:

  - **A hot reload** re-runs the module and subscribes again. A bridge that wrapped whatever it found
    would chain onto its own previous generation, so every record would arrive once per save. The hub is
    recognisable as ours and reused, and the bridge replaces its own predecessor.
  - **A foreign sink installed first** is chained rather than dropped. Something was already listening,
    and losing it silently is the class of fault this whole channel exists to make visible.
  - **The sink being taken** cannot be noticed from a hook, because overwriting a global calls nothing.
    The panel sends one record round the loop when it mounts and says so in the console if it does not
    come back. That check reads the hub it installed rather than the global it is testing — the first
    version went through `installDiagnostics`, which _repaired_ a replaced global by wrapping it and then
    reported success. A check that fixes what it measures always passes.

  A record from a package this one has never heard of renders like any other, and there is a test that
  holds it there: a `scope` of `acme/store`, no `fix`, no `data`, and the row is still complete. The
  moment the panel needs more than the five fields the protocol guarantees, a library that is not
  Ramonda's has to pretend to be one to use the channel.

  `debug` records are not forwarded to the tab, which has no level control — a collector that wants them
  subscribes.

  Because the protocol is a shape rather than a module, every package declares it, and copies drift.
  Two tests hold the join that no type can:

  - **The declarations are compared.** This package's suite reads the record out of each reporter's
    source and fails when the field names or the severities disagree — drift that is otherwise silent in
    both directions, and that TypeScript cannot catch because the copies never meet in one program.
  - **A real reporter is driven end to end.** `@ramonda/lens` is a devDependency now, for this and
    nothing else: a genuine `focusOn(state).at(9).get("title").set("x")` has to arrive as a rendered row
    in the Logs tab, with `[RML004]`, the `WARNING` colour, and `{ scope, path, index, length }` in its
    data. Also covered: an `error` severity reaching the badge, the two faults that throw arriving as
    records anyway, a panel that opens _after_ the reports being handed the history, and a write that
    lands saying nothing at all.

    Both halves of this protocol can pass while the whole is broken, which is why the whole is tested.
    Verified it can fail: mapping `warn` to the wrong word breaks two cases, and a bridge that stops
    forwarding breaks six.

    The dependency runs one way only — `@ramonda/lens` knows nothing about this package, which is the
    property the design exists to keep — and it is a devDependency, so nothing reaches a consumer's
    install and no lens code enters this package's bundle.

## 0.4.0

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

## 0.3.1

### Patch Changes

- d1e56fc: Two regular expressions replaced with linear scans. Both were the same shape — `+` anchored at
  `$`, which cannot match when the string does not end in the run it is looking for, so the engine
  retries from every position and backtracks the whole run each time.

  **`normalizePathname` (router)** is the one that mattered: it reads
  `window.location.pathname`, so the string comes from whatever URL someone was handed. Measured on
  `"/".repeat(n) + "a"` — 30k slashes took 942ms, 60k took 3.7s. A link with enough slashes hung the
  tab that opened it. The scan handles 200k in about a millisecond.

  **`create-ramonda`** trimmed dashes off a derived package name the same way (`/^-+|-+$/g`); only a
  folder name reaches it, but it is published source, and two loops are the right way to trim
  anyway. Output is unchanged on all 17 shapes checked.

  **`ramonda-check-context`** derived the tsconfig's directory with a regex; it now uses
  `path.dirname`, which is what the operation is called. Reported by CodeQL. The analyzer's result is
  unchanged — same components, same contexts, same issues, verified against an absolute path, a
  relative one, and one already ending in a separator.

  Separately, two `console` calls built their message by interpolation and passed a value after it.
  A console treats its first argument as a **format string**, so a `%s` inside the interpolated part
  consumed the argument that followed — and in both cases that argument was the payload:

  ```
  of /about%s failed:  →  "of /aboutupstream down failed:"   (the error never printed)
  ```

  `createIsrCache`'s default `onError` lost the reason a rebake failed; the devtools log row lost the
  data you clicked it to see. Both now use a `%s` placeholder. Reported by CodeQL for the first one.

## 0.3.0

### Minor Changes

- 9a36ad4: Edit a query's cached data from the panel — the one edit you see on the page immediately.

  Asked for after editing a query hook's `version` and seeing nothing: that field is an invalidation
  counter, so the write landed and the page still rendered from the cache. The **cache** is the thing to
  edit, and now `✎` on a Query row does it.

  It goes through the same `setData` an optimistic update calls, so nothing about the write is special: a
  fetch in flight is abandoned (it is older information than the write), structural sharing keeps the
  identity of what did not change, `updatedAt` moves, status becomes `success`, and every observer is
  notified. A refetch replaces it, which the panel says as it writes.

  Two refusals, both deliberate:

  - **No pencil for a value that arrived truncated.** The bridge sends a bounded copy, and a bounded copy
    carries markers where values were dropped — writing one back would put `"[… budget]"` into the cache.
    The bridge reports whether the copy is the whole value, and the panel only offers an edit when it is.
  - **No pencil when the query package is older than the panel**, since it has no write side to call.

  The list also holds still while you are typing into it: a cache event anywhere rebuilds it twice a
  second, and without that the box would vanish mid-sentence.

- cb289b6: Edit a `@state` value from the panel.

  **✎** on a state row opens the value as JSON in place: Enter applies, Escape abandons, and a
  multi-line value takes ⌘/Ctrl+Enter so plain Enter stays a newline. Invalid JSON never reaches the
  app — the parse happens first and the row says what was wrong.

  The write side of the bridge is deliberately narrow: **one field, addressed by a handle the last scan
  handed out, and only when that field is `@state` or `@persist`.** There is no way through it to an
  instance, a method, or a prop. A handle from an older scan is refused rather than landing on whatever
  now occupies that slot.

  Two limits are the framework's rules, not the panel's, and both are stated in the UI:

  - **You edit the whole field.** A signal holds a value, not a proxy, so mutating inside an object
    notifies nobody: "change `user.name`" has to become "assign a new `user`". The panel is held to the
    same rule as application code.
  - **Props have no pencil.** They are owned by whoever rendered the component and assigning to one
    throws in every build (RMD004 / RMD015). A box that pretended otherwise would either throw or look
    like it had worked until the next render put the old value back. Same for a hook's props, which come
    from its owner's callback. Core refuses the write; the panel does not offer it and says why if it is
    attempted.

  A value that cannot survive a round trip through JSON — a function, a `Map`, a DOM node — gets no
  pencil either, rather than a box that fails on Enter. The write itself goes through the ordinary
  setter, so the signal notifies, the component rebuilds, `@updated` runs, and a diagnostic fires for a
  non-serializable value, exactly as if the app had assigned it.

- 066dcf9: `</>` on any row in devtools opens that component's definition in your editor.

  This closes the flow the navigation work was for. You could already point at something on the page,
  find its component and focus it — and then you alt-tabbed and searched for the class by name. That
  was the last manual step, and the most frequent one.

  **Where the location comes from, and why it needs nothing from you.** The framework reads it off the
  stack the first time a component or hook is constructed. That was measured before it was built on: a
  subclass appears in a stack by name even when it declares no constructor of its own, and the frame's
  position is the class declaration. So there is no build plugin to install, no JSX transform to switch
  to, and no decorator a component has to carry — a bare `class Foo extends Component` is located like
  any other. One `Error` per class, cached, in a development build only.

  The alternatives were each worse: a JSX transform gives the call site (`<Foo />`) rather than the
  definition, and esbuild only injects source for the automatic runtime, which this framework does not
  use; a build plugin would be accurate and would also be a thing every app has to configure.

  **Opening goes through the dev server**, not through a `vscode://` link: Vite's `/__open-in-editor`
  hands the file to whatever editor is running on the machine that serves the app, so nothing has to be
  registered or configured, and the browser never needs the absolute path. Without that endpoint — a
  custom server — the location is copied to the clipboard and the log says so, because a button that
  silently does nothing is worse than one that hands you something to paste.

  **The position is resolved through the module's own sourcemap**, and that turned out not to be
  optional. A stack reports the file the engine loaded, and `Error.stack` is never sourcemapped
  (browsers apply sourcemaps when _displaying_ a stack, never in the string). Measured against Vite 7
  serving a real page: a class declared on **source line 20** appears on **served line 51**, because
  esbuild lowers standard decorators and prepends a preamble. Thirty-one lines is not a rounding error
  — it is a button that looks broken.

  Vite serves each module with an inline map, so the map is already in the file the browser has
  cached: fetch the module, decode the mappings, look up the segment. Verified end to end against a
  live dev server — served 51 → source 20, exactly the declaration. The file name comes from the map
  too, which is what keeps a bundled development build from opening the bundle instead of the source.
  Everything fails towards the unresolved position, which still opens the right file.

- ddd4a63: A profiler: what one commit cost, and which components it rebuilt.

  The framework's central claim is about the cost of a commit — a render being a few percent of it,
  access tracking turning nine renders into three, structural sharing turning 272 ms into 1.3 ms. Every
  one of those numbers was measured in a test, and none of them was ever visible in the panel. An app
  author could not check the claim against their own app, which is the only place it matters.

  **A commit here is one drain**, not one build: everything a single state change rebuilt, including the
  effects and `@updated` bodies it scheduled. Timing builds and summing them would leave out the diff,
  the DOM and the post-commit flush — the part that hurts.

  **Off until you press record.** A commit is the hottest path in the framework, so sampling it always
  would be a tax on every development build. Measured — and measured properly, because the first attempt
  ran off-then-on once each and reported recording as _faster_, warm-up drift being larger than the
  effect. Alternating runs, medians of seven rounds of 200 commits over a 51-component tree:

  ```
    off        253.9 ms
    recording  263.0 ms   → 3.6%
  ```

  The `PROFILE` tab lists commits newest first with their duration, and under each one the components
  that made it up with their share. The **count** is usually the more useful number: `Row ×40` after
  changing one row is not a slow component, it is forty renders that did not need to happen. A list
  rather than a flamegraph, deliberately — a flame chart of a flat drain is a picture of one bar.

### Patch Changes

- 569d509: The devtools documentation has pictures now, and they are generated rather than taken.

  Six of them — the docked panel with a component focused, the picker naming a row on the page, one value
  open on the whole panel, the Query tab, the profiler recording, and a GIF of the badge detonating, which
  is the one thing in the panel a still cannot show.

  They come from `apps/docs/scripts/shots.mjs`, which starts the playground, drives a real Chrome over the
  DevTools Protocol and writes the files. Nothing was installed for it: Chrome is on the machine, `ffmpeg`
  is on the machine, and Node has had a global `WebSocket` since 22 — which is the whole dependency list.
  A hand-taken screenshot of a devtools panel is out of date the first time the panel changes and nothing
  tells you, because a picture cannot fail a build; regenerating these is `npm run shots`, so a panel that
  no longer matches its documentation shows up as a diff.

  Captured at 2× so the panel's 13px monospace survives, then written as WebP at 1600 wide — 76 kB rather
  than the 360 kB PNG it started as, for pixels a documentation column can actually use.

- aaf7eb4: Two bugs that only the real bundle could show, and a check that now drives it.

  **The edit pencil did nothing on any row under a hook.** It packed `nodeId|key|valueId` into one
  attribute — and a value id contains the node's path, which marks a hooks branch with `|h`. So
  `split("|")` on `1|routeState|/0:component:App|h/0:hook:Router::s::routeState` handed back a truncated
  id, the lookup missed, and the click was swallowed. Three attributes now, no delimiter over data. The
  editor button was built the same way and is fixed the same way.

  This is the third time the same mistake has appeared in this panel — a query hash inside a selector, a
  prop name inside a selector, a path inside a delimiter. Never build a delimited string out of data that
  can contain the delimiter.

  **A component from another package could not be opened.** For a bundled development build the map names
  its inputs as a `../../..` chain out of the bundle's directory _on disk_, and the panel resolved that in
  the browser — where `new URL()` clamps at the web root and turns
  `../../../../../packages/router/src/Link.tsx` into `packages/router/src/Link.tsx`. The server then looked
  for it under the app and answered 422. The source now travels exactly as the map wrote it, alongside the
  module it came from, and the server does the arithmetic — it is the only party that knows a URL of
  `/assets/client.js` is a file under `dist/client`.

  **And the SSR playground's smoke test drives the panel now**: it loads the real bundle into jsdom,
  opens the tree, clicks a pencil and asserts an editor appears, then asks the editor endpoint to resolve
  a path read out of the bundle's own sourcemap. Both bugs above fail it. 102 unit tests could not see
  either, because a test tree writes its own paths and a mocked fetch answers its own questions.

- 77f1655: `</>` says what happened, instead of looking dead.

  Reported from the SSR playground: clicking it did nothing visible. It was in fact working — no editor
  endpoint on that hand-written server, so it fell back to copying the path — but the report went to
  the `LOGS` tab, which is not the tab you are on when you click a row in `COMPONENTS`. A control has to
  say what it did, where it did it: there is a toast over the panel now.

  The tooltip also stopped promising something it cannot deliver. It said `open client.js:8692 in your
editor`, which is the position in the file the engine loaded; it now says `open the definition in your
editor (served at client.js:8692)`. Resolving through the sourcemap needs a fetch, so it happens on
  the click, not once per row per render to fill in a tooltip.

  And the endpoint in this repo's SSR playground no longer answers `200` for work it did not do.
  `launch-editor` returns **silently** when the file does not exist — no callback, no log — which is how
  a request for `assets/client.js:8692` (a position in the bundle, before the sourcemap landed) produced
  a cheerful `ok` and nothing else. It checks the file itself now, answers `422` with the path, and
  passes the error callback so a spawn that fails is a 500 rather than a line on a console nobody is
  reading. `404` is left to mean the one thing the panel needs it to mean: this server has no such
  endpoint, use the clipboard.

- 19e9be3: The panel says what a write did, and when the app undid it.

  Reported: editing a query hook's `version` and `snapshot` appeared to do nothing. It did not — both
  writes landed, verified by driving the real bundle. But `version` is an invalidation counter and
  `snapshot` is the hydration transport, so what the page renders comes from the cache either way, and the
  hook sets both again on its next cache event. "It worked and the app owns that field" and "it did not
  work" looked identical, because the panel closed the box and said nothing.

  Now it says `wrote version = 99`, or `count is already that value` — and it watches the field for one
  refresh: if the app has put something else there, it says
  `version was written, and the app has since set it to 3`. Which is the answer to the question that
  prompted this, delivered where the question is asked.

## 0.2.0

### Minor Changes

- 2562896: A context consumer is no longer an empty node in devtools, and the pair is named Provider/Consumer
  throughout.

  **What a consumer reads is now visible.** A consumer holds no state and no props — every value it
  exposes is an accessor over the provider's signals — so it appeared in the panel as a node with
  nothing in it: the emptiest thing in the tree being the hook whose entire job is reading. It now
  reports, under `Reads from context`, the keys it is subscribed to with their current values, and
  names the keys it has never read.

  The catch, and the reason the consumer answers for itself rather than the panel walking its
  properties: **reading is subscribing.** A consumer's getter attaches a listener on first read, so a
  panel that read every key would silently widen what the owning component re-renders on. Only
  already-subscribed keys are read, where the subscribe branch is a no-op. There is a test that
  changes a key the consumer never reads and asserts it did not rebuild — inspecting must not change
  behaviour, and here the ordinary read does.

  Seeing which keys a consumer actually reads is worth it on its own: it is the fine-grained
  subscription made visible, the difference between "this one wakes on `color`" and "on anything in
  the theme".

  **Naming.** The docs already destructured `[ThemeProvider, ThemeConsumer]` while the framework's own
  source, tests and playground said `ThemeContext` — and devtools, which labels the hook
  `${label}Consumer`, disagreed with the code in front of you. `Consumer` everywhere now. It is also
  the more accurate name: the pair is a provider and a consumer, and unlike React's context object
  there is nothing here to take a `.Provider` off. Only local destructuring names changed; no API did.

- 34576ba: A dev error detonates the badge instead of opening the panel.

  Opening was wrong twice over: it interrupts whatever you were doing, and — once the panel docked —
  it also reflowed the app, which is how a media query flipped and the layout you were shown stopped
  being the one the error happened in. Floating fixed the reflow. This removes the interruption.

  The badge now **explodes**: a shake that overshoots both ways, two rings expanding out of it, and a
  spray of eight sparks. Then it settles into a red badge with a count and a slow breathing glow,
  which stays until you open the panel. The burst says _now_, the breathing says _still_ — a permanent
  burst would be unbearable in a session with a hundred diagnostics, and no lasting state at all would
  mean an error you glanced away from never happened. Each new error detonates again (the animation is
  restarted from JS, since re-adding a class replays nothing), the count caps at `99+`, and
  `prefers-reduced-motion` gets the colour and the count without the fireworks.

  Nothing about the app moves. The framework-initiated open (`ramonda:toggle-devtools` with
  `forceOpen`) still floats for the same reason as before.

- a83653f: The panel docks instead of covering the app, and you can pick a component off the page.

  **Docked.** Opening the panel puts a right margin on the body, so the app reflows into what is
  left. That removes a whole class of problem rather than one annoyance: as an overlay, highlighting
  a component often highlighted something the panel was covering — which is why the drawer used to
  fade after a delay, and a panel that goes transparent while you read it is its own kind of wrong.
  The fade and the dimming overlay are gone; nothing is behind the panel to fade. What docking
  cannot squeeze is an element the app positions `fixed`, or a layout pinned to `100vw` — browser
  devtools has the same limit, and the drag handle is the answer when it bites.

  **The picker** (`⌖` in the toolbar) inverts the search: hover the page, the component under the
  cursor is outlined and named next to the cursor, and a click focuses it in the tree. You almost
  always know what on screen you care about and almost never where it sits in the tree. It captures
  on `window` and swallows the press, because Ramonda attaches handlers to elements directly — a
  pick must not also submit the form it was aimed at. Escape cancels, and closing the panel or
  leaving the tab stops it, so the page is never left with a crosshair and no explanation.

  The panel also restores what it borrowed when it is removed from the DOM: the body's margin, the
  cursor. An app never removes it, but a test does, and that is where the leak showed up.

- 9fd3fa4: An error no longer reflows the app it happened in.

  Docking squeezes the page, which is right when you open the panel yourself. But the panel also
  opens **itself** on a dev error, and there squeezing is destructive: the app reflows, a media query
  flips, and the layout you are shown is not the one the error happened in. The tool changed the
  evidence by arriving.

  So an error-triggered open **floats** — the panel covers the page and nothing about the app's layout
  changes. It is the one case that needed the old overlay behaviour, and what that overlay was really
  providing was "does not reflow", so that is what floating is; the dimming is not back, because
  dimming the app you are debugging was never the useful part. A `dock`/`float` button in the header
  switches, remembers your choice for manual opens, and a line under the header says why the panel is
  floating when you did not choose it.

  An error arriving while the panel is already open changes nothing at all — reflowing on the second
  error would destroy the layout you are in the middle of reading.

  Also fixed: a panel removed from the DOM went on reacting to `ramonda:dev-log`, `ramonda:tick` and
  the rest, so a dead panel could open itself and write a margin onto the live document's body.

- 4dab8ea: Every value in the panel is a collapsible tree, and any of them opens on the whole panel.

  The one-line preview was raised twice — 120 → 2000 for a query, 200 → 8000 for state and props —
  and the ellipsis came back both times. The sizes that matter are not near any cap: an infinite
  query holding eight pages of products is a hundred kilobytes, and no line length makes that
  readable. Length was never the problem; structure was.

  So a value renders the way a browser renders one: keys and types coloured, containers labelled by
  size (`pages: Array(8)`), everything past the first level collapsed until you open it. `⤢` on any
  row opens that value on the whole panel, where it can be scrolled, switched to pretty-printed JSON,
  and copied. This applies everywhere — state, a hook's props, a component's props, a query's data.

  Two limits, and it takes both: a node budget bounds the width, a depth cap bounds the recursion,
  and a cycle is named as `[circular]` rather than truncated. Whatever is dropped says so in the row
  where it was dropped.

  `@ramonda/query`'s bridge now sends the cached value as a bounded **copy** rather than a preview
  string, so the panel cannot hold the app's objects alive or mutate them. Two related fixes fell
  out: the Query list's change signal moved from the preview to `updatedAt` — a preview is capped, so
  appending an eighth page changed nothing within the cap and the panel went on showing the seventh —
  and the panel's value-patching path looks its element up in a Map instead of a
  `[data-sv="…"]` selector, because a prop name can carry a quote, which is exactly the bug that made
  the query hash throw on every poll.

- 3112361: Navigating the component tree: focus one component, and filter by name.

  **A focus button on every row** makes that component the root of the panel, under a **breadcrumb**
  of its ancestry (`all components › <App /> › <ProductsPage /> › <ProductDetail />`). Every crumb
  is itself a focus target, so the view widens one step at a time, and Escape releases it. That is
  the flow the panel was missing: finding a component was possible, but _staying_ on it while its
  state, props and hooks change was not — the tree moved under you.

  **A name filter** in the toolbar hides every branch with no match in it, keeping the ancestors of
  a match so the result still reads as a tree. It is applied as a class rather than by re-rendering,
  so typing does not reset what you have open or where you have scrolled, and it survives a
  structural re-render because it is re-applied from the query rather than read back off the DOM.

  The pinned view renders with the paths the nodes have in the whole tree, and the structural
  signature is still read from the whole tree — otherwise the panel would rebuild itself four times
  a second while focused. There is a test for exactly that, and this package has tests now: 15 of
  them, covering the navigation, the filter, and the two Query-tab bugs that shipped in 0.1.0.

- 2562896: The panel remembers how you set it up, and where you were.

  Two stores, because these are two different kinds of thing:

  - **`localStorage` — preferences.** Width, docked or floating, and the two toolbar filters (hide
    state & props, hide hooks). That is how you like the tool; it is the same tomorrow.
  - **`sessionStorage` — the debugging session.** Whether the panel is open, which tab, the name you
    were filtering for, and the component you had focused. That is where you are in one piece of
    debugging: a reload in the middle of it is part of the session, not an interruption to recover
    from. It ends with the tab, which is right — a focused path names a tree that no longer exists
    elsewhere, and nothing is written to the URL, so a devtools session cannot follow a shared link.

  A toolbar button's label follows its stored state, so it never says "hide" while the thing is
  already hidden.

- 132e947: Bigger type, and a full view that tells you it has gone stale.

  **Every font size moved up a step** (9 → 10.5, 11 → 12.5, 12 → 13, 12.5 → 14). The panel was sized
  for a 900px drawer read at a glance; it is something you dock at 620 and read for minutes now, and
  the smallest text in it was the keys and the values — the text you actually read. A test holds the
  floor at 10.5px.

  **The full view is still a snapshot**, because a tree that moves while you are four levels into it
  cannot be read. But a snapshot that has quietly gone stale is a lie, so there is a `refresh` button
  that stays dim while the value it was opened with is current, and lights up and pulses once the app
  has written a different one. Click it and you see the new value — 194 products instead of 8 —
  with the size in the title updated. Nothing repaints until you ask.

  Compared by contents, not identity, so a rebuilt-but-equal value does not light it. If the value is
  gone entirely — the component unmounted, the entry was collected — the button says so and keeps the
  last snapshot rather than refreshing to an empty tree.

- 815aad0: The panel stops flickering, says "Props" where it meant props, and gets out of its own way.

  **The Query tab rewrote its whole list twice a second, idle or not.** `innerHTML` on every poll
  destroys and rebuilds every row, which resets hover, text selection and focus and repaints — the
  flicker you could see in the DOM inspector. It now compares a SHAPE (keys, statuses, observer
  counts, previews, errors) and rewrites only when that moves; the "updated Ns ago" text, which
  changes every tick and would otherwise defeat any comparison, is refreshed in place by hash. The
  poll is 500ms rather than 250ms, since nothing faster is readable and every tick polls every live
  cache.

  **A hook's inputs are labelled `Props`.** They were called options once, the framework renamed
  them, and the panel kept saying the old word to everyone inspecting a hook.

  **State and props are legible.** Bigger type, room to breathe, and a long value scrolls inside its
  own box instead of ending in an ellipsis — the value that got truncated is reliably the one you
  needed to read. (Both the type size and the value rendering moved again later in this release; see
  the entries below.)

  **A leaf has no disclosure triangle.** A component with no state, no props, no hooks and no
  children has nothing to open, and a triangle that reveals emptiness is a claim the reader has to
  click to disprove.

  **A toolbar for finding things:** expand all, collapse all, hide state & props, hide hooks. The
  filters are a class on the container rather than a re-render, so they are instant and every
  `<details>` stays exactly as the reader left it.

- d4f2741: The controls stay on screen, and the tree keeps your place.

  **The toolbar, search and breadcrumb are one sticky header.** They are how you find a component, and
  they used to scroll away with the tree — so the moment you found something and scrolled to read it,
  the search you found it with was gone.

  **A structural re-render no longer moves anything.** One component mounting anywhere in the app
  replaces the tree's markup, and `innerHTML` resets its container's scroll to the top — so reading a
  component while the app did anything at all threw you back to the root. The scroll position is put
  back now, and a branch you folded stays folded: the fold state is read off the DOM about to be
  replaced, rather than from `toggle` events, which are dispatched as queued tasks and would be missed
  by a rebuild landing in the same task as the click.

  Also: `@ramonda/core`'s `NOT_READ` marker moved inside its `__DEV__` block. It was stripped either
  way — measured both ways with the production-build test — but at module scope its removal depended on
  the bundler noticing that its only reader had been eliminated. Nothing that only development needs
  should have to be dead-code-eliminated when it can simply not exist, and the prod build test now
  asserts the string's absence.

  **The documentation gained a Devtools section.** It covers installing the panel and why the explicit import is the
  reliable route, the three ways to find a component (scroll, filter, or point at it on the page with
  the picker), focusing one component and working on it, reading a value as a tree and opening it on
  the whole panel, what a context consumer shows and why reading it cannot subscribe, the query cache
  tab and why there is no refetch button, docked versus floating and which case chooses for you, what
  happens on a dev error, what is remembered where, the shortcuts, and what reaches production.

### Patch Changes

- 538cb8e: The full value view was drawn under the sticky header.

  The sticky toolbar and breadcrumb were `z-index: 4` and the value view was `3`, so opening a value
  put the controls on top of it and cut the tree off two rows in. The panel's layers are now a
  documented scale — resize handle `2`, sticky head `4`, value view `10` — with the gap left
  deliberately, so the next sticky thing added cannot climb over the value view by accident.

  There is a test for the order now. Every other test in this package reads structure or classes, and
  neither can see a z-order.

- 31fc388: The package is a module as far as TypeScript is concerned, and it is type-checked.

  An app has to import the panel itself — core loads it through a dynamic import whose specifier
  is a variable, so a bundler leaves the string alone and the browser cannot fetch it. Doing that
  failed to type-check: `src/index.ts` registers `<ramonda-devtools>` and exports nothing, so
  TypeScript rejected the import with "is not a module". An explicit `export {}` says what the
  file is — a side-effect module.

  It also had no `tsconfig.json` and no `check-types` script, so 600+ lines that ship to users
  were checked by nothing. Both added; `turbo run check-types` covers 8 packages now.

- b04c39b: The Query tab's buttons did nothing, and the panel is resizable now.

  **Attribute values were never escaped for quotes.** A query's hash is JSON, so it carries `"` —
  and `data-q-hash="["products"]"` ends the attribute at the second quote. The parser then read the
  rest as bare attributes, leaving `dataset.qHash` as `[`, so **invalidate and remove looked up an
  entry that cannot exist and silently did nothing**. The same broken markup is why the age element
  could not be found, and why `refreshAges` threw
  `Failed to execute 'querySelector': not a valid selector` four times a second — one missing
  escape, three symptoms. `escapeHtml` covers `"` and `'` now, and the ages are matched through
  `dataset` in JS rather than through a selector built from data.

  **A query's data preview is capped at 2000 characters instead of 120.** 120 showed
  `{"products":[{"id":1,"title":"Essence Masc…` and stopped there, which tells you nothing the key
  did not. Both a preview and a state value scroll inside their own box now, so the cap only keeps
  a megabyte of cached data off the wire.

  **The panel opens at 620px and its left edge is a drag handle.** (It was a fixed 450px, set before
  the panel had a nested component tree and a query table in it — both wide, both wrapping into
  unreadable columns. 900px was tried in between and covered too much of the app.) The width is remembered across reloads and
  clamped to 280px…96vw: no fixed default can be right for both a query table and a narrow highlight
  check, so it is the reader's to set. The
  content scrolls on both axes, a tree row no longer wraps, and the toolbar reflows through a
  **container** query — the panel's width is dragged, not the window's, so a media query would
  never fire.

- dfca0fa: The value tree and the full view had no styles at all.

  Every class was rendered and none of them was in the stylesheet: a patch anchored on a selector
  that had since been reworded, so the section was never added. The markup was right, which is why
  33 tests passed while the buttons were browser defaults, the tree had no colours, and nested rows
  had no indentation to read the nesting from.

  Styled now: coloured keys and types, the panel's own disclosure triangles, `⤢` as a chip that
  brightens with its row, and the full view's `raw`/`copy`/`×` as real controls — `raw` looks held
  down while it is on, `×` is the only one that turns red, since it is the destructive one and the
  one hit by accident. Both tabs share it, because both render the same tree.

  `⤢` also sits in the same place in both tabs now — on the label of the value it opens — and a tree
  no longer starts flush against the edge of its box.

  And a test that would have caught it: the panel is rendered, every class it emits is collected, and
  each one is looked up in the stylesheet. Structural tests cannot see a missing rule; this one can.

## 0.1.0

### Minor Changes

- d69cf21: A QUERY tab in the devtools panel.

  Every entry in every live cache: the key, status and fetch status, how many components are
  watching, how long ago the data arrived, a preview of it, the failure count, and whether it
  came from a server render. Per row, **invalidate** (mark stale and ask whoever is watching to
  refresh) and **remove** (throw the data away).

  **No refetch button**, and that is the design rather than an omission: the fetcher belongs to
  the observer, not to the cache, so a query nobody is watching has no function to call.
  `invalidate` is the honest equivalent — the same thing a mutation's `invalidates` does.

  **Pull, not push.** The panel is a custom element outside the tree, so it cannot see a
  provider; `@ramonda/query` installs `__RAMONDA_QUERY__` in a development build and the panel
  calls it while its tab is open, four times a second, and not at all otherwise. That is the
  model core already uses for `__RAMONDA_INSPECT__`, and the reason is the same: a cache changes
  on every fetch, every observer arriving and leaving, every invalidate and every sweep, and
  pushing all of that into a panel nobody is looking at would cost something in every
  development build.

  **Providers register, clients do not.** A client belongs to a provider and there can be
  several, so registration happens in the provider's `@create` (client only — a server render
  has no panel, and `@destroy` never runs there) and is undone in `@destroy`. A torn-down tree
  therefore takes its cache out of the list, so the panel cannot hold one alive or show one
  that no longer exists.

  Ten tests on the bridge, plus one in the production run asserting the global is never
  installed. Two of them are notes rather than checks: `remove` on a key something is still
  watching does not make the row vanish — the observer re-subscribes onto a fresh entry and
  fetches again, because `remove` notifies observers with `"removed"` exactly so they stop
  rendering something deleted — and a row whose entry was collected between being drawn and
  being clicked is looked up fresh, so an action on it does nothing instead of throwing.

  One finding recorded in the code: `@create` ignores what it returns. A teardown returned from
  it is silently dropped — that contract belongs to `@effect` and `createSubscriptionDecorator` —
  so the registry grew by one per test until the two halves were written out as `@create` plus
  `@destroy`.

## 0.0.2

### Patch Changes

- [`70edd68`](https://github.com/NBlasko/ramonda/commit/70edd680fe048baff7d450e9ef73ca5f08edcb92) Thanks [@NBlasko](https://github.com/NBlasko)! - Unify the brand on violet (#7A4FBF) and make the devtools UI English-only — "No active components…" and a proper × close button.
