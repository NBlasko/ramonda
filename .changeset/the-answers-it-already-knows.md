---
"@ramonda/check": minor
---

`--fix` writes the answers the checker already knows

Most advice cannot be applied by a machine: "give it a name" needs a person to know what the thing
is called. A few faults are not like that — `httpEquiv` becomes `http-equiv` and there is nothing to
decide — and for those, printing a sentence and making somebody type it was work the tool could have
done.

`ramonda-check --fix` applies them. `--fix --dry-run` says what it would apply and touches nothing.

**The bar for a rule carrying an edit is one answer, and it must be the right one.** Not "the usual
fix", not "what they probably meant". A wrong edit costs a reader a revert, and their trust in every
edit that was right along with it. So `--fix` is never "this run is now clean" — everything needing
a person is still reported, and still counted.

Three things the fixer does to stay honest:

- **Overlapping edits are dropped, not merged.** Two rules wanting the same characters disagree
  about what those characters should say, and picking the first, or the longer, or the one whose
  rule is registered earlier, is a coin toss wearing a rule's name. The run says how many it left.
- **Edits are applied back to front**, so an earlier one cannot move a later one's offsets.
- **A file is written once, or not at all.**

Six rules carry an edit, across three kinds:

| | |
|---|---|
| `class` → `className` | `class-instead-of-classname` |
| `httpEquiv` → `http-equiv`, and three more | `attribute-that-does-nothing` |
| `playbackrate` → `playbackRate` | `misspelled-element-property` |
| `aria-labelledBy` → `aria-labelledby` | `unknown-aria-attribute` |
| `disabled="false"` → `disabled={false}` | `false-on-a-boolean-attribute` |
| remove `selected` | `option-that-cannot-choose` |

And every one of those rules reports faults it does NOT fix, which is where the bar lives:

- `class` beside an existing `className` — which of the two they meant to keep is not written down.
- `class` on a COMPONENT — the rename reaches the prop, and the answer is in that component's file.
- `innerHTML` — its answer is "put it in the children", a change of shape rather than a span.
- `aria-requred` — one edit from a real name is a GUESS, and the report says so with a question mark.
  Only the CASE fix is carried, and only in SVG: `setAttribute` lowercases for HTML, so
  `aria-labelledBy` on a `<span>` genuinely works and is not a fault at all.
- `disabled={NO}` with `const NO = "false"` — whether that name has to stay a string elsewhere is
  not knowable from the line.

The loss check caught the change to its own inputs, which is the job it was written for: every
finding of the first rule to carry an edit read as LOST, because the claim had gained a field while
the rule reported exactly as before. `edit` is a span, and a span moves whenever a fixture gains a
line above it — so it is normalised away like `line` and `column`, with the gap that leaves written
down beside it.
