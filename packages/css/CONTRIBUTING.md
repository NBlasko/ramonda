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
| `tokenShapes.generated.ts` | `build-token-shapes.mjs` | grammar from mdn-data, longhands measured |

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
| `check-shorthand-split.mjs` | the splitter disagreeing with what an engine renders |
| `check-css-splitting.mjs` | the CSS not following its JavaScript chunk, on a real build |

Three of them carry their own selftests, run through the `SELFTEST` environment variable —
`collide`, `drift`, `crowd`, `moved` for layer names, `order` for skew, `slot` for the split. Each
one plants a specific fault and asserts the gate catches it. They run in `pnpm check` as separate
steps, right before the gate itself.

## Four rules the code cannot state about itself

**Ask the engines, not mdn-data.** Its `computed` field disagrees with every shipping engine for
18 of 77 families, so a longhand list taken from it is silently wrong. The one field it is good
for is the grammar — that is why `tokenShapes.generated.ts` reads the grammar from mdn-data and
measures everything else.

**Take the union across engines, never the intersection.** If one engine resets a longhand and
another does not, the longhand belongs in the list. A missing reset is the fault nobody sees: the
old value stays on the element and nothing fails.

**A layer name cannot be added later.** An older stylesheet does not list it, so CSS appends the
unseen name at the end — the strongest position. Every name the scheme will ever use is declared
now, with room left over. `check-layer-names.mjs` is what holds that.

**Break every new check once, on purpose.** A check that has never been seen to fail is not
evidence. This is not a suggestion: five checks in one day passed while measuring the wrong thing,
and each one sent the work in a wrong direction until it was broken deliberately. The `SELFTEST`
modes are the durable form of the same rule.

## Where to start

Add the failing test first. Everything lives flat in `src/__tests__/`. Sixteen of the compiler's
files have a test of the same name — that is the convention when a change is confined to one file;
the rest are named for a subject that crosses several. A test here is expected to say what it is
about in prose, not just assert, and each case names the measurement that found it missing. Read
`classify.test.ts` for the register. Then:

```
pnpm --filter @ramonda/css test      # just this package
pnpm check                           # the whole gate, from the repo root
```

## What is unfinished

`split.ts` fills slots. It does not parse. For a positional family that is enough — how many
values were written decides which longhand each one feeds. For a comma-separated family it is
not. Thirteen of those exist; `tokenShapes.generated.ts` carries **two**, `scroll-timeline` and
`view-timeline`, and they are the two whose items are a plain sequence of closed slots.

`matchValue.ts` is the parser meant to finish the job: it reads a value *against* its grammar and
says which term took which token. It is written, tested, and **not wired into anything yet**. It
is correct where it was measured, and fast — `animation: 1s 2s spin ease` resolves to duration,
delay, name and easing in under a millisecond and eleven calls to the recogniser. It also gets
the two cases the slots got wrong, which is why it exists: `animation: --zz` is a name, and
`mask: 7px` is a position.

Two families defeat it. `background` and `font` are `||` groups whose components can each be
read several ways, and the backtracking explores the orders one at a time: twenty million calls
to the recogniser, and still no answer. Memoising on the pair *(term, position)* is the fix, and
a hard cap on the work is what makes a pathological grammar refuse instead of hang. Refusing is
safe — an unparsed value stays a shorthand.

**The parser takes one item's grammar, not the family's.** `animation`'s own grammar is
`<single-animation>#`, which to this is a single leaf. Whoever wires it in resolves the named
type first. That is why `split.ts` still owns the comma, and only the item is parsed.
