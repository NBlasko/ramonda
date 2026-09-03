---
"@ramonda/core": minor
"@ramonda/check": patch
---

`Timeout` and `Interval` say whether they are running, and a labelled player is no longer reported

**`pending` and `done`.** `pending` is true from `start` until the call fires or `stop` clears it;
`Timeout` also has `done`, whether the call has happened. Both are reactive, so a render that reads
one is re-rendered when it flips — which is why they are `@state` on the hook rather than a getter
over the private handle, since a getter would read correctly and never wake the render that read it.

The state was always there and always `protected`, so a component that wanted to show "Undo" while a
deadline ran kept its own flag beside the timer and wrote it in three places — `start`, `stop`, and
the body, and a fourth if the body restarted it. Every one of those is a chance for the flag and the
timer to disagree with nothing to say so.

Both false is the third answer a caller needs, without a third field: nothing started yet, or `stop`
cancelled it before it fired. `Interval` has no `done` — it does not finish, so there would be
nothing for it to mean. And neither flag costs a hydration byte: nothing arms on the server, so both
stay at their initializer and the serializer writes only what moved off one.

**A label silences `media-with-no-captions`.** The rule asked for one in its advice and did not
accept it in its code: "a song without words needs a label beside the player rather than a track:
the title, the performer, the length. What is being asked for is not a transcript of every sound, it
is that the page not be silent ABOUT the sound." Measured on
`<audio src="/song.mp3" controls aria-label="Chopin, Nocturne op. 9 no. 2, 4:33" />` — reported, with
advice telling the author to do what they had already done.

`aria-label` or `aria-labelledby` now silences it, on `<video>` as well. An EMPTY label does not:
that is a label written and nothing said, the same care the `muted` escape takes about
`muted={false}`. A label computed at runtime counts, because the direction this rule errs in is
silence rather than a false report about working markup.
