---
"@ramonda/check": patch
---

Three rules whose one-line summary was the thing a reader judged them by

The summaries go into the reference table, so they are what somebody reads before ever running the
rule — and all three were describing something other than what the rule does.

**`attribute-that-does-nothing`** said "an attribute is written whose name reaches the DOM verbatim
and that nothing reads", which sounds like it covers every unread attribute. It reports a closed list
of six camelCase names — `httpEquiv`, `acceptCharset`, `defaultValue`, `defaultChecked`, `innerHTML`,
`textContent` — and never touches a `data-*`. The summary names them now, and the advice says so
outright: a `data-*` written for a CSS selector or a test hook is what `data-*` is for.

**`fresh-object-in-props`** spent most of its summary listing WHERE the object could be built — in the
attribute, an arm of a ternary, behind a `??`, a local one line up, a helper it calls — which is not
what a reader needs. What they need is that it is rebuilt every render, and what to do: a field, a
`@compute`, or `@StableProps` on the child. The summary says that instead; the advice, which was
already thorough, is unchanged.

**`media-with-no-captions`** said "so its content exists only as sound", which for a song is not a
fault, it is the point. It now names what is actually wrong — nothing on the page says what is in it
— and the advice speaks to music directly: a song with words carries them as `descriptions`, one
without needs a label beside the player rather than a track. What is asked for is not a transcript of
every sound, it is that the page not be silent about the sound.

No rule changed what it reports.
