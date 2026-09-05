---
"@ramonda/core": minor
---

Three diagnostics for a style block the runtime cannot use.

The framework owns a `css` prop whose meaning comes from a compiler, and the honest half of that
bargain is that a value the two disagree about is said out loud rather than silently absorbed. All
three were measured before they existed:

- **`RMD062`** — a compiled block with holes is a function, and reading it without calling it applies
  the class with **no** custom properties, so every declaration reading one falls back. Silent.
- **`RMD063`** — a hole's value holding a `;` would become a second declaration, so it is refused and
  the declaration is dropped. Silent, and the reason it is refused is a server round trip that turned
  one into real, applied declarations.
- **`RMD064`** — a value that is not a compiled block at all. This one did not do nothing: it **threw**
  `Cannot read properties of undefined (reading 'length')`, taking the render down and naming nothing
  about `css`. It is ignored now, class included, and the element renders unstyled.
