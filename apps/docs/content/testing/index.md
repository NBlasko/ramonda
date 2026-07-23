---
title: Setup
description: "@ramonda/testing-library — built on the DOM Testing Library, with the one part only Ramonda can know."
section: Testing
order: 100
---

# Testing

```
pnpm add -D @ramonda/testing-library @testing-library/dom
```

```tsx
import { render, screen, fireEvent } from "@ramonda/testing-library";

test("counts up", () => {
  render(<Counter start={2} />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("count is 3")).toBeTruthy();
});
```

No `await`, no `settle()`, no cleanup call. That is the point of the package.

## What it adds, and what it does not

The queries, `screen`, `waitFor`, `within` and `prettyDOM` are **not** reimplemented — they are
the DOM Testing Library's, re-exported. That library is framework-agnostic on purpose, it is
where the query semantics people already know come from, and a copy would be a worse version of
it that also has to be maintained.

Anything you can import from `@testing-library/dom`, you can import from here.

Three things are Ramonda's, because only Ramonda can know them:

| | why |
|---|---|
| [`act`](/testing/act) | renders are batched through a microtask; only the framework knows when the queue is empty |
| [`render`](/testing/rendering) / [`renderHook`](/testing/hooks) | mounting a Ramonda tree, and diffing a re-render into it |
| `fireEvent` | the DOM library's, wrapped so the render an event causes is committed before it returns |

`cleanup` is the fourth, and it runs itself.

## Config

```ts
// vitest.config.ts
export default defineConfig({
  define: { __DEV__: JSON.stringify(process.env.NODE_ENV !== "production") },
  esbuild: { jsxFactory: "h", jsxFragment: "Fragment", target: "es2022" },
  test: { globals: true, environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
```

```ts
// test/setup.ts
import { h } from "@ramonda/core";
(globalThis as unknown as { h: typeof h }).h = h;
```

`globals: true` is what lets cleanup register itself.

## Cleanup runs after every test

Automatically, when the framework exposes a global `afterEach`.

**It is not tidiness.** Two failures worth knowing about, both measured on the ad-hoc harness this
package replaced:

1. A leaked container keeps a **live** tree — its `@interval`s keep firing and its window
   listeners stay attached, into whatever test runs next.
2. Ids stop being unique across containers, and jsdom resolves even a *scoped*
   `container.querySelector("#x")` through a document-wide index — so a query returns a node from
   an **earlier** test. Those tests pass one at a time and fail together, pointing at the wrong
   file.

Neither looks like a leak from the outside.

## Next

- [Rendering and querying](/testing/rendering).
