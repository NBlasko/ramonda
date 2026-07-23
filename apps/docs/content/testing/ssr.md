---
title: Testing server rendering
description: Assert the markup, the head, and — the part that matters — the state.
section: Testing
order: 104
---

# Testing server rendering

```ts
const page = await renderPage(<App />);

expect(page.title).toBe("Get started — Ramonda");
expect(page.body).toContain("Install it.");
expect(page.head).toContain('name="description"');
```

`renderPage` runs entirely in jsdom, so a server render is an ordinary test with no server
involved.

## Testing hydration

```tsx
const html = await renderToString(<App />);
const { getByText } = render(<App />, { hydrate: html });
```

Pass the markup as a string and the harness owns the container, so automatic cleanup covers it —
which matters most here, because a leaked hydration test leaves a live tree that the next one
hydrates on top of.

`hydrate: true` is the React-compatible form: it adopts whatever is already in a `container` you
supplied, and that container is then yours to remove.

## Assert that nodes were *adopted*, not just correct

The DOM being right does not mean hydration worked. A tree that was thrown away and rebuilt looks
identical.

```tsx
const before = container.firstElementChild;
render(<App />, { container, hydrate: true });
expect(container.firstElementChild).toBe(before);   // same node
```

Node identity is what separates "adopted" from "replaced". Combine it with an interaction —
rebuilt content is interactive too, so a click alone proves nothing:

```tsx
expect(node).toBe(serverNode);
fireEvent.click(node);
expect(getByText("clicked")).toBeTruthy();
```

## Assert state, not only markup

The most valuable lesson from testing this framework's own hydration.

Removing the router's URL re-read left every test green — because the first render was correct
anyway. The route context had captured its options **before** the state blob was restored, so the
markup was right while the state was wrong. Only reading the state showed it.

If a test is about hydration, read the thing hydration restores.

## Testing async server work

```tsx
class Profile extends Component {
  @state name = "";
  @mount async load() { this.name = await getUser(); }
  render() { return <p>{this.name || "…"}</p>; }
}

const html = await renderToString(<Profile />);
expect(html).toContain("Ada");
```

`renderToString` awaits promises returned by lifecycle methods, so this needs no special handling.

**Use a macrotask in the test**, not a resolved promise:

```ts
const slow = () => new Promise((r) => setTimeout(() => r("Ada"), 5));
```

A `Promise.resolve()` settles in a microtask, which the old microtask-only drain already handled —
so a test written with one would pass whether or not the feature works. That is a real trap: it
was how this behaviour looked fine for a long time while every realistic import failed.

## Next

- [Diagnostics](/guide/examples) — the codes the framework reports.
