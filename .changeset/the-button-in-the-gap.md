---
"@ramonda/check": minor
---

`empty-heading-or-link` now covers the BUTTON, which was in the gap between two rules

`control-with-no-label` skips `<button>` on purpose and says so: a button is named by what is inside
it, so asking it for a `<label>` would be asking for the wrong thing. `empty-heading-or-link`
covered the two tags that carry text and not the third. Measured on a plant:
`<button onclick={close} />` was reported by nothing, while the `<a href="/x" />` beside it was
reported.

That is the icon button — the ✕ that closes a dialog, the pencil that edits a row — and it is
written more often than an empty link and an empty heading together. A screen reader announces it as
"button" and nothing else, with no way to find out what it does short of pressing it. Nothing on
screen will ever remind anybody, because it looks finished.

The rule's existing walk answers it unchanged: an `aria-label` or `aria-labelledby` names it, text
inside names it, one readable word beside a hidden icon is enough, and content this cannot read —
an expression, or a component child — is left alone.

**`<input type="submit">` and `type="button"` are NOT this**, and that is a boundary rather than a
limitation. Those are named by their `value` and by a browser default, so an unlabelled submit reads
as "Submit" rather than as nothing; they belong to `control-with-no-label` and its documented line.
Only the `<button>` ELEMENT is named by its content.

`EmptyHeadingOrLinkIssue.kind` gains `"button"`, and the report gets its own sentence for it.
