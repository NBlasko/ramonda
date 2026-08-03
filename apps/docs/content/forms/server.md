---
title: Forms on the server
description: What a server-rendered form puts in the HTML, why the row ids match on both sides, and the one case where the two disagree on purpose.
section: Forms
order: 99.4
---

# Forms on the server

A form renders on the server like anything else, and needs nothing wired up to do it. What
follows is what actually reaches the HTML and what happens when the browser picks it up.

## What is in the markup

`bind` puts `name` and `value` on every control, so the server-rendered page is a real HTML
form before a line of JavaScript runs. It has the values, and it posts under the names you
declared in the schema.

```html
<input name="email" value="" aria-invalid="false" />
<input name="address.city" value="Beograd" aria-invalid="false" />
<input name="tags[0]" value="ramonda" aria-invalid="false" />
```

A field's `name` is its path, which is also what `setError` takes — so an API that answers with
`{ "address.city": "we do not deliver there" }` can be applied straight through.

## Hydration keeps the nodes

The browser adopts the server's DOM rather than rebuilding it. For a form that matters more
than for most pages, because a rebuilt input is an empty input: anything typed between the HTML
arriving and the bundle running would be gone.

The part that has to line up is the **row ids** in an array field. They are generated, so if
the two sides numbered them differently every `list()` key would disagree and every row would
be thrown away and rebuilt. They do not, because each array numbers its own rows from zero,
independently of which array a render happened to read first. Server and browser walk the same
schema in the same order and arrive at the same ids.

This is asserted, not assumed: the SSR playground's smoke test renders the form on a real
server, hydrates it in a real browser, compares the row ids on both sides, splices a row, and
checks that the surviving rows are still holding the same DOM elements.

## Validation at creation, and the async case

A form validates its defaults once when it is created. Without that, an empty required form
would report `isValid: true` until something was touched — and a submit button disabled on
`isValid` would start out enabled, or a "save" that starts out disabled would have no way to
become enabled.

That means **the schema runs once with the default values**, which is the one cost worth
knowing about: a schema carrying an async rule — a uniqueness lookup, say — performs it at
creation.

On the server an async answer is **dropped rather than awaited**. Nothing would be waiting for
it, and it would resolve into a hook whose tree has already been serialised and sent, so
landing it would schedule a render on a page that no longer exists. A form with an async schema
therefore reports `isValid: false` in the server-rendered markup, which is the honest answer to
"we have not heard back yet". The browser asks again on hydration and the answer arrives
normally.

A synchronous schema — which is nearly all of them — has none of this: it answers during the
server render and the markup carries the real state.

## Buttons that depend on validity

```tsx
<button type="submit" disabled={!this.form.isValid}>Save</button>
```

With a synchronous schema this is correct on both sides. With an **async** one, the server
renders it disabled and the browser enables it once the schema answers — a change on hydration,
which is expected here rather than a mismatch to fix.

If you would rather not have the button move, gate on the submit attempt instead:

```tsx
<button type="submit" disabled={this.form.isSubmitting}>Save</button>
```

`submit` validates before it calls `onSubmit`, so an invalid form reveals its messages instead
of sending. That is usually the better interaction anyway: a disabled button with no
explanation is the version of this that people complain about.

## Working without JavaScript

Because the markup carries `name` and `value`, a server-rendered form posts correctly with the
bundle blocked or still loading. Point the `<form>` at an endpoint and let the browser do it:

```tsx
<form action="/api/signup" method="post" onSubmit={this.form.submit}>
```

`submit` calls `preventDefault`, so once the page is interactive your handler runs and the
browser's own submission does not. Before that, the plain HTML submission is what happens. The
schema still has to run on the server in that path — the browser's validation is a convenience,
never the check.
