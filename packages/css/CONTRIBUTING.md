# Working on `@ramonda/css`

The other two documents in this folder answer *why* (`DESIGN.md`) and *what both halves agreed
on* (`CONTRACT.md`). **This one answers *where*.** It
exists because `DESIGN.md` is over five thousand lines, and a person arriving to fix one thing
should not have to read it to find the file.

Nothing here is a rule about style. It is a map, four house rules that the code cannot state
about itself, and an honest note on what is unfinished.

## Which file answers which question

`src/` holds four folders, split by where the code runs:

| Folder | What is in it |
| --- | --- |
| `compiler/` | everything that reads a block and decides what it means — the table below |
| `runtime/` | what ships to the browser: `merge.ts`, `value.ts`, `token.ts`, `conditions.ts`, `key.ts` |
| `config/` | the project's `ramonda.css.ts`: reading it (`config.ts`), its types (`declared.ts`), the files it generates (`codegen.ts`) |
| `adapters/` | each tool the compiler is plugged into: `vite.ts`, `esbuild.ts`, `plugin.ts` (the editor), `cli.ts`, `check.ts`, `prettier.ts` |

Beside `src/`, `probes/` holds the scripts that measured what the design rests on — kept as
evidence, not run by anything; its README says which still run.

The rest of this table is in `src/compiler/`.

| If you are asking | Read |
| --- | --- |
| where are the blocks in this file? | `scan.ts` |
| what does this one block say? | `read.ts`, then `ast.ts` for the shape it produces |
| are two blocks the same block? | `normalise.ts` — its output *is* the identity |
| what class name does this get? | `names.ts` — the only thing two independent builds must agree on |
| what does this declaration set, and which layer does it land in? | `flatten.ts` |
| what does the finished stylesheet look like? | `sheet.ts` |
| what longhands does this shorthand write? | `split.ts` |
| which longhand does this piece of the grammar feed? | `classify.ts` |
| how does a family's grammar become leaves that belong to longhands? | `openGrammar.ts` |
| how is a written value read against a grammar? | `matchValue.ts` |
| how is a CSS grammar parsed at all? | `valueSyntax.ts` |
| what does `{expr}` become? | `tooling.ts`, `dollar.ts`, `variables.ts`, `references.ts` |
| why did the checker complain? | `rules/` — one family of rules to a file, `index.ts` runs them — or `typed/` when the rule needs a `ts.Program`, a file to each |
| how does a diagnostic get back to the author's line? | `virtual.ts` |
| what is the whole transform? | `transform.ts` |

Three files are worth knowing exist even if you never open them. `errors.ts` is every message this
can produce. `nearest.ts` is the near-miss search behind *did you mean*. `remember.ts` is how a pure
answer about a property and a value is worked out once per build rather than once per declaration.

## What is generated, and by what

A file named `*.generated.ts` says `Do not edit` at the top, and means it. Editing one is undone
by the next build and caught by `pnpm check`.

| File | Written by | Source |
| --- | --- | --- |
| `keywords.generated.ts` | `build-css-properties.mjs` | mdn-data |
| `keywords.engine.generated.ts` | `build-engine-keywords.mjs` | the three engines, measured |
| `numberless.generated.ts` | `build-numberless-properties.mjs` | the three engines, measured |
| `prefixed.generated.ts` | `build-prefixed-properties.mjs` | mdn-data + the engines |
| `leaves.generated.ts` | `build-shorthand-leaves.mjs` | mdn-data + the engines |
| `shapes.generated.ts` | `build-shorthand-shapes.mjs` | the three engines, measured |
| `initials.generated.ts` | `build-initial-values.mjs` | the three engines, measured |
| `grammarShapes.generated.ts` | `build-grammar-shapes.mjs` | grammar from mdn-data, every placement measured |

All of them live in `scripts/css/` at the repo root, beside the gates below, and all of them take
`--check`, which fails instead of writing.

**Regenerating needs browsers.** Anything marked *measured* drives Chromium, Firefox and WebKit
through Playwright, sets the declaration, and reads back what the engine did. `--check` drives
them too, so `pnpm check` does not pass on a machine without them installed.

```
node scripts/css/build-shorthand-shapes.mjs          # rewrite the table
node scripts/css/build-shorthand-shapes.mjs --check  # fail if it is stale
```

## The gates

`pnpm check` at the repo root runs all of these. In the order they run:

| Gate | What it would catch |
| --- | --- |
| `check-css-blocks.mjs` | a file with a block in it that no wrapper handles |
| `check-css-system.mjs` | a committed `css-system/` that no longer matches its config |
| `build-*.mjs --check` | a generated table that is stale |
| `check-layer-skew.mjs` | two releases on one page, and the wrong declaration winning |
| `check-shorthand-split.mjs` | the positional splitter disagreeing with what an engine renders |
| `check-hand-splits.mjs` | a family split by hand disagreeing with any engine, or splitting a value one refuses |
| `check-must-split.mjs` | a value people write that silently stopped splitting, or splits wrong |
| `check-render-equality.mjs` | a block page whose PIXELS are not the hand-written page's — the pairs are in `scripts/css/render-pairs.mjs` |
| `bench-css.mjs 5` | the benchmark no longer running — it times nothing here; `pnpm bench:css` is the 1000-file run, `--profile` says where the time goes |
| `check-css-splitting.mjs` | the CSS not following its JavaScript chunk, on a real build |

**The grammar table has no gate beside it, because the gate is inside the generator.** Every family
is reproduced in three engines before a row is written — the shorthand on one element, our
longhands on another, whole computed style compared — and a family that fails one value, or that an
engine HAS and compared nothing for, is not written. So `build-grammar-shapes.mjs --check` is the
gate: it re-measures and fails when the committed table is not what the engines here report.

Two switches make a run readable, and the second is worth knowing before you go hunting:

```
WHY=1 node scripts/css/build-grammar-shapes.mjs                    # what each engine turned down
WHY_FAMILY=animation node scripts/css/build-grammar-shapes.mjs     # every value of one family
```

Every browser gate carries its own selftests, run through the `SELFTEST` environment variable —
`order` for skew, `slot` and `half` for the positional split, `change` and `joined` for render
equality, `refuse` for must-split, `flex` and `forget` for the hand splits. Each one plants a
specific fault and asserts the gate catches it. They run in `pnpm check` and in CI as separate
steps, right before the gate itself.

A selftest that catches its break prints ONE line, on stdout — `[must-split] SELFTEST=refuse caught
its break, as it must: 45 reported — the first: …` — so every detailed difference in a log is a real
one. A selftest that catches nothing fails, with its reason. `scripts/lib-selftest.mjs` is the line.

## Four rules the code cannot state about itself

**Ask the engines, not mdn-data.** Its `computed` field disagrees with every shipping engine for
18 of 77 families, so a longhand list taken from it is silently wrong — the measurement is written
out in `DESIGN.md` and summarised in `THIRD-PARTY.md`. The one field it is good for is the grammar,
which is why `grammarShapes.generated.ts` reads the grammar from mdn-data and measures every
placement in it.

**Which way engines are merged depends on what the list is READ FOR**, and there is no blanket
rule — `scripts/css/engine-facts.mjs` says this at length, and the one time that note claimed a blanket
rule is how a list stayed wrong.

A list that WIDENS a check takes the union: `leaves.generated.ts` holds every longhand ANY engine
resets, because a missing reset is the fault nobody sees — the old value stays on the element and
nothing fails. A list that decides the OUTPUT takes the intersection: `grammarShapes.generated.ts`
writes a family only where every engine that HAS it agreed, and `initials.generated.ts` only where
all three compute the same value, because a wrong answer here writes the author's value into the
wrong longhand, silently.

An engine that does not HAVE a family says nothing either way. Counting its silence as a
disagreement dropped three families the others agreed about completely.

**A layer name cannot be added later.** An older stylesheet does not list it, so CSS appends the
unseen name at the end — the strongest position. So every name is a WORD that means the same in
every release — `a`, `v`, `p`, `u`, `c` and the ten breakpoint digits — and none is a count of
longhands, which moves when CSS adds one. There is no reserve beside them: what would need a new
name is caught by a test instead — `grammarShapes.test.ts` asserts every split reaches leaves.

**Break every new check once, on purpose.** A check that has never been seen to fail is not
evidence. This is not a suggestion: five checks in one day passed while measuring the wrong thing,
and each one sent the work in a wrong direction until it was broken deliberately. The `SELFTEST`
modes are the durable form of the same rule.

## Where to start

Add the failing test first. Tests live in `src/__tests__/`, flat — except the rules', which are in
`src/__tests__/rules/`, one file to each family in `compiler/rules/`, with the helpers they share in
`helpers.ts`. Nineteen of the compiler's forty files have a test of the same name — that is the
convention when a change is confined to one file;
the rest are named for a subject that crosses several. A test here is expected to say what it is
about in prose, not just assert, and each case names the measurement that found it missing. Read
`classify.test.ts` for the register. Then:

```
pnpm --filter @ramonda/css test      # just this package
pnpm check                           # the whole gate, from the repo root
```

## What is unfinished

`split.ts` asks two tables and one hand-written file, and between them they answer **92 families** — every shorthand there is, but `all` and
`-webkit-mask`, below.

`SHAPES` answers a POSITIONAL family — how many values were written decides which longhand each one
feeds, and no grammar is needed at all. **48 families.** A length family also carries whether it
takes a negative and a percentage, asked of the engines: `scroll-margin` takes no `10%`, and a split
of `scroll-margin: 10% 5px` would set the `5px` a browser drops with the rest.

Everything else is read against the family's own grammar, opened by `openGrammar.ts` until every
leaf belongs to a longhand and carried in `grammarShapes.generated.ts`. **27 families**, including
`animation`, `transition` and `font-variant`, none of which a flat list of slots can hold.

`splitByHand.ts` answers the families that fit neither, with CSS's own rules written out: a keyword
standing for several longhands (`white-space: pre`, `flex: none`), a word that switches a longhand on
(`font-synthesis: weight`), a part copied into the parts left out (`grid-area: a`), and every form
of `<position>` for `background-position`, `mask-position` and `-webkit-mask-position`, and
`background` and `mask` layer by layer on top of it, `font`, the ranges of `animation-range` and
`timeline-trigger`, `grid` and `grid-template` with their area strings, `mask-border`, and the
fallbacks of `position-try`. **35 by hand.**
Eighteen of them are in a table too, and the hand rules win: a table is learned from sentinels, and
a value no sentinel was ever like it read wrong or not at all. `grid-column: 2` set the end to `2`
where every engine says `auto`; `animation-range: cover` ran to `normal`, not to `cover`; and
`grid-column: 1 / -1`, `columns: 2`, `place-items: first baseline` did not split. The first two
are why `check-shorthand-split.mjs` asks every family's own words; the rest are why
`check-must-split.mjs` exists — a list of values people write, each of which must split, and
split right. No other gate notices a value that silently does not.
The specification is not the oracle there either — `check-hand-splits.mjs` puts every value of a
corpus into all three engines, as the shorthand and as the split, and a value ONE engine refuses is
refused here too: Chromium drops `text-box: cap`, and a split would have applied it. A family in
none of the three keeps its shorthand.

**Four are not shorthands here at all**: `transform-origin`, `perspective-origin`, `vertical-align`
and `border-spacing`. Some engine holds each of them as a longhand — measured, the first two in
Chromium and Firefox, `vertical-align` in Chromium and WebKit, `border-spacing` in Firefox — and the
engines disagree about what they reset, so no split could write one page for all three.
`build-shorthand-leaves.mjs` records them as `LONGHAND_IN_SOME_ENGINE` and `SHORTHANDS` leaves them
out, so they sit in `u` with every other longhand.

**One is refused outright**: `-webkit-mask`. Chromium and Firefox reset `mask-clip`,
`mask-composite` and `mask-mode` with it, and WebKit keeps them, so the author's own line renders
two ways before any split is asked. The leaves generator records it as `RESETS_DIFFER`, and
`resets-differ-across-engines` refuses it and names `mask`, which every engine has.

`all` covers every property and has a layer of its own, `ramonda.a`, a word.

**Every family the grammar generator could not take is split by hand now.** Some never opened —
`mask`'s `content-box` reaches `mask-origin` only through `<coord-box>` → `<paint-box>` →
`<visual-box>`, and `longhandsFor` matches a word against a longhand's grammar TEXT without
following those types; that gap in the opener is still there. Others opened and the measurement
turned them down. `ONLY=flex WHY_FAMILY=flex node scripts/css/build-grammar-shapes.mjs` says why for one
family, and writes nothing.

**A value is refused where CSS would drop it, and the family is kept.** CSS drops a whole
declaration when any part of it is invalid and a split drops only the part — so a split must never
write half of a value the browser ignores. Four ways that happens, each refused on its own:

- a word the longhand has no place for: `place-items: start space-between`, `justify-items` having
  no `space-between`. The checker reports this one too, as `word-out-of-its-longhand`.
- a word that is only ever PART of a value: `first baseline` and `safe center` are one value of two
  words, and `align-items: first` alone is invalid. Each positional family carries `alone`, the
  words every engine takes as a longhand's whole value, and a slot holding anything else refuses.
  The checker does NOT read that list, because `place-items: first baseline` is valid CSS.
- a leaf feeding several longhands that took more than one token: `scroll-margin: 1px 2px`.
- a token landing on a longhand the shorthand resets but cannot set: `animation: 1s spin scroll()`.

**And one VALUE the engines disagree about.** `animation: auto` is `animation-name: auto` in
Firefox and touches nothing in Chromium or WebKit, so no single split writes the same page in all
three. It is listed as `contested` on the shape, and the build refuses it as
`value-differs-across-engines` — the author's own line renders two ways, so it is not an option.

**Known and not fixed**: `container: card / inline-size` is refused. The positional learner never
learned the slash form for `container` — its patterns are `1` to `4` — so every value with the `/`
keeps its shorthand. Safe, and a gap.

A refusal is safe wherever it happens. The declaration stays a shorthand, which is visibly the
author's own text — where a wrong split is invisible. And a shorthand that reaches the stylesheet
is not left to chance: the compiler emits the family's longhands beside it as `shorthands({…})`,
so `mergeClassNames` clears what a later shorthand covers, and the layer order settles the rest.
Measured end to end against Chromium over both orders of eight shorthand-and-longhand pairs: no
difference from what plain CSS does.
