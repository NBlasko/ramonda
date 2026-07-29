# @ramonda/devtools

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
