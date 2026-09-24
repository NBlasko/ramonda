---
"@ramonda/css": patch
---

**A rule the build names is a key you can actually switch off.** Two of them were not.

A refusal prints the rule's id in front of the sentence so a reader knows which key to write in
`ramonda.css.ts`. For a fault about the SITE — where the block is written rather than what is in
it — that key did nothing: `checkBlock` has honoured `rules` since it took a config, and
`checkSite` and `checkNamedSite` never saw one.

| written | `rules: { …: "off" }` | a `ramonda-css-ignore` above it |
|---|---|---|
| `<div className=@@( … )>` | refused anyway | let through, and it compiled correctly |
| `@@wat( … )` | refused anyway | let through, and it compiled correctly |

Two escape hatches offered as equals, one of them shut. Both work now.

`block-in-a-template` is the one that must not be silenced — a block inside a `${ … }` reaches the
bundler as `@@(` — and it was already right: it names no key, and neither hatch opens it. The rule
table says so rather than leaving the reader to find out.
