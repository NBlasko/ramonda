# Working on `@ramonda/css`

The other three documents in this folder answer *why* (`DESIGN.md`), *in what order*
(`PLAN.md`) and *what both halves agreed on* (`CONTRACT.md`). **This one answers *where*.** It
exists because `DESIGN.md` is over five thousand lines, and a person arriving to fix one thing
should not have to read it to find the file.

Nothing here is a rule about style. It is a map, four house rules that the code cannot state
about itself, and an honest note on what is unfinished.

## Which file answers which question

Everything below is in `src/compiler/`.

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
| why did the checker complain? | `rules.ts`, or `typed.ts` when the rule needs a `ts.Program` |
| how does a diagnostic get back to the author's line? | `virtual.ts` |
| what is the whole transform? | `transform.ts` |

Two files are worth knowing exist even if you never open them. `errors.ts` is every message this
can produce. `nearest.ts` is the near-miss search behind *did you mean*.

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

All of them live in `scripts/` at the repo root and all of them take `--check`, which fails
instead of writing.

**Regenerating needs browsers.** Anything marked *measured* drives Chromium, Firefox and WebKit
through Playwright, sets the declaration, and reads back what the engine did. `--check` drives
them too, so `pnpm check` does not pass on a machine without them installed.

```
node scripts/build-shorthand-shapes.mjs          # rewrite the table
node scripts/build-shorthand-shapes.mjs --check  # fail if it is stale
```

## The gates

`pnpm check` at the repo root runs all of these. In the order they run:

| Gate | What it would catch |
| --- | --- |
| `check-css-blocks.mjs` | a file with a block in it that no wrapper handles |
| `check-css-system.mjs` | a committed `css-system/` that no longer matches its config |
| `build-*.mjs --check` | a generated table that is stale |
| `check-layer-names.mjs` | a layer name that stopped meaning what an older sheet meant by it |
| `check-layer-skew.mjs` | two releases on one page, and the wrong declaration winning |
| `check-shorthand-split.mjs` | the positional splitter disagreeing with what an engine renders |
| `check-css-splitting.mjs` | the CSS not following its JavaScript chunk, on a real build |

**The grammar table has no gate beside it, because the gate is inside the generator.** Every family
is reproduced in three engines before a row is written — the shorthand on one element, our
longhands on another, whole computed style compared — and a family that fails one value, or that an
engine HAS and compared nothing for, is not written. So `build-grammar-shapes.mjs --check` is the
gate: it re-measures and fails when the committed table is not what the engines here report.

Two switches make a run readable, and the second is worth knowing before you go hunting:

```
WHY=1 node scripts/build-grammar-shapes.mjs                    # what each engine turned down
WHY_FAMILY=animation node scripts/build-grammar-shapes.mjs     # every value of one family
```

Three of them carry their own selftests, run through the `SELFTEST` environment variable —
`collide`, `drift`, `crowd`, `moved` for layer names, `order` for skew, `slot` for the split. Each
one plants a specific fault and asserts the gate catches it. They run in `pnpm check` as separate
steps, right before the gate itself.

## Four rules the code cannot state about itself

**Ask the engines, not mdn-data.** Its `computed` field disagrees with every shipping engine for
18 of 77 families, so a longhand list taken from it is silently wrong — the measurement is written
out in `DESIGN.md` and summarised in `THIRD-PARTY.md`. The one field it is good for is the grammar,
which is why `grammarShapes.generated.ts` reads the grammar from mdn-data and measures every
placement in it.

**Which way engines are merged depends on what the list is READ FOR**, and there is no blanket
rule — `scripts/engine-facts.mjs` says this at length, and the one time that note claimed a blanket
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
unseen name at the end — the strongest position. Every name the scheme will ever use is declared
now, with room left over. `check-layer-names.mjs` is what holds that.

**Break every new check once, on purpose.** A check that has never been seen to fail is not
evidence. This is not a suggestion: five checks in one day passed while measuring the wrong thing,
and each one sent the work in a wrong direction until it was broken deliberately. The `SELFTEST`
modes are the durable form of the same rule.

## Where to start

Add the failing test first. Everything lives flat in `src/__tests__/`. Seventeen of the compiler's
thirty-three files have a test of the same name — that is the convention when a change is confined to one file;
the rest are named for a subject that crosses several. A test here is expected to say what it is
about in prose, not just assert, and each case names the measurement that found it missing. Read
`classify.test.ts` for the register. Then:

```
pnpm --filter @ramonda/css test      # just this package
pnpm check                           # the whole gate, from the repo root
```

## What is unfinished

`split.ts` asks two tables, and between them they answer **72 families**.

`SHAPES` answers a POSITIONAL family — how many values were written decides which longhand each one
feeds, and no grammar is needed at all. **42 families.**

Everything else is read against the family's own grammar, opened by `openGrammar.ts` until every
leaf belongs to a longhand and carried in `grammarShapes.generated.ts`. **30 families**, including
`animation` and `transition`, neither of which a flat list of slots can hold. A family in neither
table keeps its shorthand.

Of the 51 families that reach the grammar table's generator, 21 do not make it, and they fail at
two different places.

**Nine have a grammar this cannot open**, because some part of them belongs to no longhand and has
no grammar of its own to be opened into: `border-spacing`, `flex`, `font`, `mask`, `mask-border`,
`perspective-origin`, `text-box`, `transform-origin`, `white-space`. `mask` is the near miss —
`<visual-box>` sits one level past the depth cap.

**Twelve open and the measurement turns them down**: `background`, `contain-intrinsic-size`,
`font-synthesis`, `font-variant`, `grid`, `grid-area`, `grid-template`, `marker`, `mask-position`,
`place-items`, `place-self`, `vertical-align`. Most fail the step that settles which longhand an
ambiguous leaf feeds. `place-items` and `place-self` fail for a nameable reason: one written value
fills BOTH longhands — `place-items: center` sets `justify-items` too — and the grammar says
`<align-items> <justify-items>?` without saying that the second copies the first.

**One VALUE can be refused without losing the family.** `animation: auto` is `animation-name: auto`
in Firefox and touches nothing in Chromium or WebKit, so no single split writes the same page in
all three. It is listed as `contested` on the shape and refused on its own; every other value of
`animation` splits.

A refusal is safe wherever it happens. The declaration stays a shorthand, which is visibly the
author's own text — where a wrong split is invisible. And a shorthand that reaches the stylesheet
is not left to chance: the compiler emits the family's longhands beside it as `shorthands({…})`,
so `mergeClassNames` clears what a later shorthand covers, and the layer order settles the rest.
Measured end to end against Chromium over both orders of eight shorthand-and-longhand pairs: no
difference from what plain CSS does.
