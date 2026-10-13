---
title: Testing
description: Test a Ramonda app with the DOM Testing Library plus the few pieces only Ramonda can provide.
section: Testing
order: 100
---

# Testing

A test renders a component, finds what a person would see, acts on it and checks the result — with
the DOM Testing Library's queries, and the few pieces only Ramonda can provide:

```tsx
import { render, screen, fireEvent } from "@ramonda/testing-library";

test("counts up", () => {
  render(<Counter start={2} />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("count is 3")).toBeTruthy();
});
```

No `await`, no `settle()`, no cleanup call. That is the point of the package.

## Install

Two packages, as development dependencies — this one, and the DOM Testing Library it builds on:

```install
-D @ramonda/testing-library @testing-library/dom
```

## What it adds

The queries you already know — `screen`, `getByText`, `waitFor`, `within` — are the
**DOM Testing Library's**, re-exported unchanged. Anything you can import from
`@testing-library/dom`, you can import from here.

A few things are Ramonda's, because only Ramonda can know them:

| | |
|---|---|
| [`act`](/testing/act) | renders are batched onto a microtask; only the framework knows when the queue is empty |
| [`render`](/testing/rendering) / [`renderHook`](/testing/hooks) | mounting a Ramonda tree, and diffing a re-render into it |
| `fireEvent` | the DOM library's, wrapped so the render an event causes is committed before it returns |
| `cleanup` | runs itself after every test |

## Config

```ts
// vitest.config.ts
import { ramonda } from "@ramonda/build/vite";

export default defineConfig({
  define: { __DEV__: JSON.stringify(process.env.NODE_ENV !== "production") },
  plugins: [ramonda()],
  test: { globals: true, environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
```

The tests go through the same transform as the app, so they get the same plugin. That
is not only tidiness: on Vite 8 nothing else lowers the decorators.

There is no setup file to write for JSX. The compiler imports Ramonda's runtime per file, so
nothing has to be put on `globalThis` and there is no factory name to keep in step with the config.

`globals: true` is what lets cleanup register its own `afterEach`.

## Cleanup runs after every test

Automatically — and it isn't just tidiness. A leaked container keeps a *live* tree
(its `@interval`s keep firing, its listeners stay attached) into the next test, and
duplicate ids across containers make a scoped query return a node from an earlier
test. Both make tests that pass alone fail together, pointing at the wrong file.

## Next

- [Rendering and querying](/testing/rendering).
