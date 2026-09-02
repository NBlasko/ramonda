---
title: mounted
description: Run a method once the component's DOM is in the document — the first moment it can reach the page.
section: Reference
order: 128
---

# `@mounted`

Runs **once**, after the component's DOM is in the document. This is the first moment it can reach
the real page: focus an input, measure an element, hand a node to a library that wants one.

## The situation it is for

A dialog that opens with the cursor already in its first field. Nothing about that can be decided
while rendering — the input does not exist yet, and `focus()` on nothing does nothing:

```tsx
import { createRef } from "@ramonda/core";

class RenameDialog extends Component<{ name: string }> {
  @state draft = "";
  private box = createRef<HTMLInputElement>();

  @created
  seed() {
    this.draft = this.props.name;
  }

  @mounted
  takeFocus() {
    this.box.current?.focus();
  }

  render() {
    return (
      <form>
        <label>
          New name
          <input ref={this.box} value={this.draft} />
        </label>
        <button type="submit">Rename</button>
      </form>
    );
  }
}
```

The two decorators are doing different jobs and the order is the difference: `@created` sets the
value that the first render draws, `@mounted` reaches the element that render produced.

**Children mount before their parent.** By the time a parent's `@mounted` runs, everything inside it
is already on the page — so a parent measuring its children finds them there.

## Running on one side only

Like [`@created`](/reference/decorators/created), it takes `env` — and here the default is worth
knowing: a server render never mounts anything, so a `@mounted` method simply does not run there.
`env: "client"` is the honest spelling when the code would make no sense on a server anyway.

```tsx
@mounted({ env: "client" })
measure() {}
```

## What it refuses

**Anything but a method.**

## What it costs, and when not to reach for it

It runs after the DOM is committed, so anything it writes to state causes a **second** render. That
is correct for a measurement — you cannot know a width before there is a box — and wasteful for a
value you could have derived. If the answer does not need the page,
[`@created`](/reference/decorators/created) or a [`@compute`](/reference/decorators/compute) gets it
without the extra pass.

An `async` one that rejects with nothing to catch it is reported as
[`RMD059`](/reference/diagnostics/rmd059).

## Next

- [Lifecycle](/concepts/lifecycle) — all four moments, in order.
- [Refs](/concepts/refs) — how to hold the element this reaches for.
- [`@updated`](/reference/decorators/updated) — every commit after this one.
