---
"@ramonda/core": minor
---

`EventOn<T>` — the one line the DOM's own types cannot type

The event itself has always been typed from the name: `onclick` gives a `PointerEvent`, `onkeydown` a
`KeyboardEvent`, from the DOM's own map. Reading the ELEMENT is a separate question, and it did not
work:

```tsx
<input onchange={(e) => (this.draft = e.currentTarget.value)} />
//                                     Property 'value' does not exist on type 'EventTarget'
```

`currentTarget` is `EventTarget | null`, because in the DOM an event can be listened for anywhere. So
every handler that reads a field off its own element opened with a cast — the type system being told
to look away.

```tsx
import type { EventOn } from "@ramonda/core";

<input onchange={(e: EventOn<HTMLInputElement>) => (this.draft = e.currentTarget.value)} />
<button onclick={(e: EventOn<HTMLButtonElement, PointerEvent>) => e.currentTarget.blur()} />
```

## Why it is opt-in, with the numbers

The obvious version is to parameterise the whole handler map by the element, so no annotation is
needed anywhere. It works, and it costs. Measured on `apps/docs` with `--extendedDiagnostics`, type
**instantiations went from 244,875 to 346,688** — and not as a fixed cost: `packages/router` moved a
third as far, so it scales with how much JSX a codebase contains. That is a tax on every consumer's
build in exchange for saving an annotation.

Narrowing it to the events people actually reach for does **not** help: restricting the intersection
to eight event names produced 346,688 instantiations, to the digit. TypeScript instantiates the whole
mapped type per element type whatever is inside it. The note in the source says so, so nobody
measures it twice.

## `target` is deliberately not narrowed

`currentTarget` is the element the listener is attached TO, which the framework knows because it
attached it. `target` is where the event ORIGINATED, and for anything that bubbles that is any
descendant — a click on a `<span>` inside a `<button>` has the span as its target. A type naming it
as the button would be wrong exactly when a reader most needs it right.

Both claims are pinned in `JsxTypeClaims.tsx`, in both directions, and each was checked by relaxing
it and watching the `@ts-expect-error` go unused.

`RamondaEvent<T>` is gone. It typed `target: T` — the unsound half — was used nowhere, and was never
exported from the package, so it could not be reached even deliberately.
