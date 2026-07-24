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

`renderPage` runs entirely in jsdom, so a server render is an ordinary test — no
server involved.

## Testing hydration

```tsx
const html = await renderToString(<App />);
const { getByText } = render(<App />, { hydrate: html });
```

Pass the markup as a string and the harness owns the container, so cleanup covers it —
which matters here, because a leaked hydration test leaves a live tree the next one
hydrates on top of.

## Check that nodes were *adopted*, not just correct

The DOM being right doesn't prove hydration worked — a tree thrown away and rebuilt
looks identical. Node identity is what separates "adopted" from "replaced":

```tsx
const before = container.firstElementChild;
render(<App />, { container, hydrate: true });
expect(container.firstElementChild).toBe(before); // same node
```

## Assert state, not only markup

If a test is about hydration, read the thing hydration restores. (A real lesson:
removing the router's URL re-read left every test green because the markup was right
while the *state* was wrong — only reading the state showed it.)

## Testing async server work

```tsx
class Profile extends Component {
  @state name = "";
  @mount async load() {
    this.name = await getUser();
  }
  render() {
    return <p>{this.name || "…"}</p>;
  }
}

const html = await renderToString(<Profile />);
expect(html).toContain("Ada");
```

`renderToString` awaits promises returned by lifecycle methods. **Use a real macrotask
in the test**, not a resolved promise:

```ts
const slow = () => new Promise((r) => setTimeout(() => r("Ada"), 5));
```

A `Promise.resolve()` settles in a microtask, so a test using one would pass whether
or not the feature works — a real trap.

## Next

- [Diagnostics](/reference/diagnostics) — the codes the framework reports.
