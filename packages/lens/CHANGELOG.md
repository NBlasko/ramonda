# @ramonda/lens

## 0.3.2

### Patch Changes

- ccc64fe: Every package's npm page carries the same four facts, and `homepage` points at its own docs

  The README is published, so this is a change to what a reader lands on. Measured before it was
  written: of eleven published packages, five carried no licence, three named no install command
  anywhere, one had no badges, and two linked to no documentation at all. `create-ramonda` and
  `@ramonda/devtools` had no README whatsoever — their npm pages were blank.

  Those facts are now generated from the sources that already held them — the package name, its
  `peerDependencies` (required ones appear in the install line; `bguard` is declared optional and
  so does not), and `homepage`, which now points at the package's own documentation section rather
  than at the site root. npm shows `homepage` beside the package, so that is a better npm page on
  its own as well as the one source the README link is written from.

  Nothing below the generated region changed. Each README keeps its own voice, and its own headings.

## 0.3.1

### Patch Changes

- 5632f32: The documentation is at **ramonda.dev**, and everything that names it says so.

  The site was reachable only at its Cloudflare Pages subdomain, `ramonda.pages.dev`, and that address was
  written into 63 places. The custom domain is attached now, so all of them name it: `homepage` in every
  published `package.json`, every README, the URL a diagnostic tells you to open, the scaffolder's closing
  line, both `create-ramonda` templates, and `BASE` in `apps/docs/src/entry-server.tsx`.

  **`BASE` is the one that mattered beyond tidiness.** Every `canonical`, `og:url`, `og:image` and the
  whole of `sitemap.xml` and `robots.txt` are built from it — its own docblock warned that a move would
  take the canonical tags and leave the sitemap behind. Left alone, every page on the new domain would
  have told a search engine that the real page is on `pages.dev`. Verified on a real build rather than
  assumed: `Sitemap: https://ramonda.dev/sitemap.xml`, `<loc>https://ramonda.dev/…`, and the canonical
  and `og:image` tags on the built pages.

  **Two places deliberately keep the old host.** The CHANGELOGs: those are published release notes, the
  links were correct when they were written, `pages.dev` still resolves, and rewriting them would be
  rewriting history. And `.github/workflows/README.md`, where `ramonda.pages.dev` is a FACT about
  Cloudflare — the project's name is its subdomain — so the sentence stays and gains the one that was
  missing: the site is served at the custom domain, and leaving anything on `pages.dev` is how a search
  engine is told the real page is elsewhere.

## 0.3.0

### Minor Changes

- fedc99f: A lens write keeps hidden symbols across an edit, and `set` takes an option.

  `list()` recognises a row by the object it holds. Every immutable update replaces that object, so the row was torn down and built again — taking whatever its component was holding with it: a half-typed input, an open menu, a scroll position.

  Anything looking at the result afterwards has to GUESS which new object is which old row. A lens write does not have to: at the moment it replaces a value it is holding both versions, so the answer is known. It now carries the value's non-enumerable symbols onto the copy, and `focusOn(rows).at(0).merge({ done: true })` keeps that row's component exactly as it was.

  `set` is the exception. It is handed a value rather than deriving one, so `set(edited)` and `set(aDifferentRow)` are the same call, and carrying would give a different row the open editor of the row it replaced. It keeps nothing unless told:

  ```ts
  focusOn(items).at(0).set(other); // a different value
  focusOn(items).at(0).set(rebuilt, { keepSymbols: true }); // the same one, rebuilt
  focusOn(items)
    .at(0)
    .set(rebuilt, { keepSymbols: [MINE] }); // only this one
  ```

  The lens knows nothing about what the symbols mean — `keepSymbols` is generic, and `merge`, `update` and a write aimed deeper all keep automatically because they derive. Core exports `SAME_ITEM` as the ready-made option, so an app never has to name the symbol behind it:

  ```ts
  this.rows = focusOn(this.rows).at(0).set(fromTheForm, SAME_ITEM);
  ```

  `1.33 KB → 1.50 KB` gzipped.

## 0.2.0

### Minor Changes

- fb18a94: `push` and `insert` write into an array that is not there yet, and three keys are refused

  Two changes to behaviour, plus documentation for a trap the sharing guarantee carries with it.

  **`push` and `insert` create the array.** `set` already created a missing key, because `tags?:
string[]` is a type TypeScript accepts and refusing it at runtime made the API disagree with its
  own types. `push` on that same missing key warned and did nothing — so the two spellings of one
  intent disagreed, and the type system offered both:

  ```ts
  focusOn(state).get("post").get("tags").set(["a"]); // created it
  focusOn(state).get("post").get("tags").push("a"); // did nothing
  ```

  Both land now. A missing or `null` value counts as an empty array; a value that IS there and is
  not an array is still reported and still changes nothing. `push()` with no items stays a no-op
  rather than minting an empty array, so a write that changes nothing still returns the original
  root.

  `merge` deliberately does not create, and the line between them is what the operation can
  supply: `push` hands over a complete array, while `merge` has only a `Partial`, so creating from
  it would mint a half-built object typed as a whole one. Use `set` where the object itself may be
  missing.

  **`__proto__`, `constructor` and `prototype` are refused as keys.** `get` takes a `string |
number`, so a key can come from data — a field name, a key off a parsed request body — and every
  write ends in an assignment into the copy. Assigning to `__proto__` does not create a property:
  it runs the setter `Object.prototype` provides and replaces the copy's prototype. They are
  refused in a path, in `remove`, and in a `merge` partial (an object literal cannot carry an own
  `__proto__`, but `JSON.parse` can).

  This guard is **not** compiled out of the production build, unlike every diagnostic in the
  package — only its message is. A check that ran solely in development would protect the one build
  that was never exposed to a request. It costs 116 bytes gzipped, measured as `gzip -9` of the
  minified bundle: 1216 → 1332 bytes.

  **Documented, with no behaviour change:** that the result shares objects with the input, so
  mutating either one mutates the other — the consequence of the identity guarantee, and the one
  way to get a wrong result out of a correct write. Also an installation line, that the package
  stands on its own with no dependency on the framework, that a branch of `and` has to `return`,
  `insert`'s negative index, that the double-write guard and `focusOn(root).remove()` throw in
  development and do nothing in production, and that `value()` cannot tell a missing path from a
  present `undefined`. Every development message now has a page of its own — **Messages you might
  see** — mapping each one to its cause and its fix.

- fb18a94: Diagnostics are records with codes — `RML001` … `RML011`

  Every report this package makes now carries a **stable code** and reaches a collector as a structured
  record, not only the console as a sentence:

  ```
  [Ramonda lens RML001] .profile is undefined, so .profile.city could not be reached. Nothing was changed.

  → Only the LAST hop creates what it names, so a gap before it cannot be walked through. Set the
    intermediate value first, or `merge` the whole object into place.
  ```

  **Why a record.** A string carries a fault to a human and nowhere else: nothing can filter it by
  severity, group it by cause, or count it, without parsing prose. So a report is now a
  `RamondaDiagnostic` — `code`, `scope`, `severity`, `message`, `fix`, `data`, `time` — handed to
  whatever sink is installed:

  ```ts
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => {
    if (record.severity === "error") myCollector.alert(record);
  };
  ```

  `globalThis` rather than an event on `window`, so the same line works in the browser, in Node, in a
  worker and during a server render. A collector is optional: with none installed the call is one
  property read and the message still goes to the console, and installing one adds a consumer rather
  than silencing anything. This package still has **no dependencies** — the contract is the shape and
  the name of the sink, which is why it is documented rather than imported.

  **Eleven codes, not twenty-one messages.** A code is a fault _class_ — a cause with one fix — so `at`
  on an object and `where(…).remove()` on an object are one code with two messages. Each has a section
  in the [diagnostics reference](https://ramonda.pages.dev/reference/diagnostics), and
  [Messages you might see](https://ramonda.pages.dev/lens/messages) maps every message text to its code
  for when you have the console output and not the code.

  **Severity says whether the code can be right**, which is a sharper line than "how bad it looks".
  An **error** means it cannot be, whatever the data holds — a wrong kind of value (`RML003`, `RML006`),
  a refused key (`RML009`), a branch that returns nothing (`RML008`), a second write (`RML010`). A
  **warning** means it may well be, and the data was simply empty or absent (`RML001`, `RML004`,
  `RML005`, `RML007`). A path steps _through_ a nullable value by design, so reporting that as an error
  would raise an alarm about a program doing exactly what it was written to do. Errors print with
  `console.error`, warnings with `console.warn`.

  The two faults that **throw** now report before they throw, so a panel sees what a throw would
  otherwise keep to itself.

  Production is unchanged and emits **nothing**: every report is behind `__DEV__` at its call site, and
  the production suite now asserts that through the sink — a devtools bundle that happens to be loaded
  receives silence rather than a stream to filter. `RML009`'s _check_ still runs in production, because
  a guard that ran only in development would protect the one build never exposed to a request; only its
  message is stripped.

  **It costs 32 bytes gzipped in production** — 1332 to 1364, `gzip -9` of the minified bundle — and
  getting it there took a measurement rather than an assumption. Every report is behind `__DEV__`, so
  the bundler drops `report`, and it _keeps the 2.2 KB table of fix text that only `report` read_:
  tree-shaking is one reachability pass over top-level symbols, and dropping a function does not send it
  back to reconsider what that function was the only reader of. A table behind `__DEV__ ? … : {}` needs
  no such pass — the literal is gone at parse time. The same trick applied to the function bodies leaves
  three empty shells worth 16 bytes instead of 300. Both numbers are recorded where the code is, because
  neither is guessable from reading it.

  Two tripwires keep the contract from rotting, since a written contract is the one thing in this
  repository with nothing behind it: the record's shape is asserted in this package's suite, and the
  docs' `check-api-coverage.mjs` now fails the build when a code has no section in the reference, when a
  package raises a code carrying another package's prefix, or when a section describes a code that is
  raised nowhere. Each of the four checks is proved to fail on demand with `DOCS_SELFTEST`.

## 0.1.0

### Minor Changes

- 56608f3: `@ramonda/lens` 0.1.0 — the first real release.

  It has been sitting at 0.0.1 not because it was unfinished but because it never got a changeset. What is
  there: `focusOn` and its types, zero dependencies, 718 lines, 57 tests including one that asserts the
  public surface, three documentation pages, an entry in the API reference, a demo on the docs site, an
  add-on in the scaffolder, and a benchmark against immer. Nothing about it is experimental, so it is
  released rather than labelled.

  Added before releasing it: **a production test run**. Every warning in `apply.ts` is behind
  `if (__DEV__)`, and the ordinary suite pins that flag true — so the code path a published app takes had
  never been executed by a test, which is the shape of a bug core shipped once. `test` now runs
  `test:prod` after it.

  That suite asserts the **contract** rather than the guards, and the reason is recorded in it: I tried to
  break it the obvious way, by moving an early `return` inside a `__DEV__` block so production would fall
  through where development stops, and production behaved identically — every warned-about path in
  `apply.ts` is backed by a second, non-dev guard that catches the same case. So what it asserts is the
  promise: a write lands, everything untouched keeps its identity, and a path that goes nowhere returns
  **the original root, not a copy**. That last assertion has teeth; "does not throw", which is what it said
  first, did not.
