---
"@ramonda/check": patch
---

The accessibility tables are read to REPORT, so a wrong entry reports correct markup and a missing
one misses a fault. They were compared against machine-readable transcriptions of the specifications
— `aria-query` and `dom-accessibility-api` — rather than read again.

**Most of them were already right, and that is the useful half of the result.** Every ARIA role,
every abstract role, every `aria-*` attribute, and every token set matches the specification exactly.
Where the tables have extras — `comment` and `suggestion` as roles, `aria-colindextext` and
`aria-rowindextext` — they are ARIA 1.3 names the transcription has not caught up with, and having
them means not reporting valid markup.

**`role-takes-no-name` reported correct markup on `<time>`.** It is named from AUTHOR in both
transcriptions, and giving a machine date a human name is the documented use of the element:
`<time datetime="2026-03-03" aria-label="3 March 2026">`. The entry is gone. `mark` stays on a split
verdict, with the reason written down: `aria-query` transcribes the spec's characteristics table
field by field and gives it `nameFrom: ["prohibited"]`.

**`control-with-no-label` was missing three of HTML's labelable elements** — `meter`, `progress` and
`output`. Each renders a value and nothing else, so without a name a reader is told "50%" with no
word for what is at 50%. They are labelable exactly as an `<input>` is, and every way of naming one
is the same way. `<button>` stays out on purpose: a button is named by what is inside it. The report
says what a reader is actually told, which differs for a value and for an empty box.

**`tag-needs-its-parent` was missing ruby annotation** — `<rt>` and `<rp>` belong directly inside
`<ruby>` and nowhere else, now that `<rtc>` has been removed from the standard. `<area>` stays out
for the opposite reason, and it is the shape worth remembering: it needs a `<map>` ANCESTOR rather
than a `<map>` parent, so `<map><p><area /></p></map>` is legal and an entry would report it.

Two omissions from `ROLE_REQUIRES` are now written down as decisions rather than left to look like
oversights: `treeitem`'s `aria-selected`, which moved between ARIA 1.1 and 1.2 exactly as `option`'s
did, and `combobox`'s `aria-controls`, which points at a popup that does not exist while the
combobox is collapsed. And the two token LISTS, `aria-relevant` and `aria-dropeffect`, are named as
the values no closed set can judge without splitting them first.
