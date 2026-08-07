---
"@ramonda/form": patch
---

Hydration: a form that arrived as markup had never validated

`@created` defaults to `env: "shared"`, and core **skips a shared create during hydration** — on
purpose, because it already ran on the server. The model behind that is sound: whatever the create did
is captured in the hydration blob. A form's values, messages and `validated` are plain fields rather
than `@state`, deliberately, because a form holds whatever the schema's input side is — so none of it
survives to the client, and nothing had ever validated there.

Measured: a form whose defaults PASS sent `<button disabled={false}>` from the server, and hydration
turned the button off, with nothing able to turn it back on until the reader edited a field. The exact
failure the priming validation exists to prevent, arriving by the one path nothing had tested.

Fixed with a client-only `@created` that primes if the shared one did not run on this side, which also
restores the devtools announcement for a hydrated form.

**`FormState` had the same hole**, and this is why it now registers on its first READ rather than from
`@created`: a read happens in the render, on whichever side is rendering, so there is nothing to skip.
It re-registers whenever the set of facts it watches grows, which keeps the form's record of "the
answers as last published" comparing against the truth rather than a default.

The SSR cost of watching is written down rather than left to be discovered: every watched component
ships `{"version":0}` in the blob, because the subscription is a `@state` counter and `@state` means
"serialize me". Always zero on the server, and restoring zero is a no-op — around 17 KB of markup at
300 rows that buys nothing. The fix belongs in core, where a `@state` still holding its initial value
could be left out of the blob entirely.

And `NO_MESSAGES` is one frozen value in `validate.ts` now, beside `NO_ISSUES`, instead of a copy per
module. Sharing it is what keeps a render stable — a fresh `[]` per read is a new identity, which is
what RMD020 reports — and freezing it means a caller who pushes into what they were given hears about
it instead of adding a message to every field on the page.
