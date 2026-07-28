---
"@ramonda/core": minor
---

New lifecycle decorator: `@updated` — runs after the DOM of an **update** is committed.

`@mount` runs once, with the element in the document. `@updated` runs after every commit after that, and it is the only way an app can read or correct its own committed DOM: updates are batched through a microtask, so the DOM is not touched yet when the handler that changed state returns — and not every update has a write site of yours to stand in (a parent re-renders you with new props, a context value changes, a hook you use writes its state).

```tsx
class Row extends Component<{ selected: boolean }> {
  @updated
  keepVisible() {
    if (!this.props.selected || this.scrolled) return;
    this.scrolled = true;
    this.element.scrollIntoView({ block: "nearest" });
  }
}
```

**No dependencies, no previous values, no cleanup**, and each is deliberate:

- Nothing is tracked while it runs, so there is no dependency list to get wrong — and no repeat of the trap that makes an effect the wrong tool for this: an effect re-runs when a dependency *changes*, and a dependency that is an array or object rebuilt by a props callback changes on every render.
- The `if` that would want previous props is reconstructing what changed, which is `@watchProp`'s job. The `if` that belongs here asks "is the DOM already how I want it?" — and only the author can answer that. So: **reacting to a value → `@watchProp`; touching the DOM afterwards → `@updated`**.
- Cleanup is `@destroy`'s; a subscription is `createSubscriptionDecorator`'s.

It fires unconditionally, so guard an expensive body — a `getBoundingClientRect` forces a layout, which costs orders of magnitude more than the dispatch (~270ns).

Runs **children before parents**, after this commit's mounts and effects, and never on the server. Writing state in it schedules another render (the measure-store-render pattern); a runaway is reported as RMD009.

A component that does not declare it pays a length check, not an entry in the flush.
