---
title: updated
description: Run a method after every commit except the first, with the new DOM already in place.
section: Reference
order: 136
---

# `@updated`

[`@mounted`](/reference/decorators/mounted) runs once. `@updated` runs after **every commit after
that**, with the new DOM already in place — so it is where a component reads or corrects the page
once it has changed.

```tsx
class Row extends Component<{ selected: boolean }> {
  private element!: HTMLElement;
  private scrolled = false;

  @updated
  keepVisible() {
    if (!this.props.selected || this.scrolled) return;
    this.scrolled = true;
    this.element.scrollIntoView({ block: "nearest" });
  }
}
```

## The `if` it always needs

`@updated` runs after every commit, not only the one you were waiting for. So the first line of one
is almost always a guard — and the question it should ask is **"is the DOM already how I want it?"**,
not "what changed?".

Reconstructing what changed is [`@watchProp`](/reference/decorators/watchProp)'s job, and it does it
*before* the render, where the answer can still affect what is drawn.

## What it refuses

**Anything but a method.**

**Options.** Unlike the other three it takes none, and there is nothing to configure: a commit only
happens in a browser, so `env` would have one possible value.

## What it costs, and when not to reach for it

It runs on every commit of this component, which is the most often of the four. A state write here
causes another commit, which runs it again — so a guard that can stop is not tidiness, it is what
keeps it from looping.

Three things belong elsewhere:

- **Deriving a value from a prop** → [`@watchProp`](/reference/decorators/watchProp), before the
  render rather than after it.
- **Cleanup** → [`@destroyed`](/reference/decorators/destroyed).
- **A subscription** → [your own decorator](/hooks/own-decorators), which handles both ends.

## Next

- [Lifecycle](/concepts/lifecycle) — all four moments, and why there is no post-commit `@watchProp`.
- [`@watchProp`](/reference/decorators/watchProp) — reacting to a prop before the render.
