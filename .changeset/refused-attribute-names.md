---
"@ramonda/core": minor
---

The JSX types now refuse five attribute names that reach the DOM verbatim and do nothing, with the
correct spelling written into the error.

An HTML attribute is given to `setAttribute` as it stands, which lowercases it. Exactly two names
are aliased on the way, because they are reserved words: `className` → `class`, `htmlFor` → `for`.
Everything else is written as HTML spells it — **including the hyphens**. So a camelCase name whose
real attribute is spelled differently arrives as something no browser reads. It renders, it does
nothing, and there is nothing on the page to see.

Measured by rendering every camelCase name a JSX author might reach for and reading back what landed
in the document. These six came back dead; the rest (`readOnly`, `maxLength`, `tabIndex`, `colSpan`,
`srcdoc`, `datetime`, `contentEditable`, and the rest) all lowercase correctly and are untouched:

| refused | write instead |
|---|---|
| `httpEquiv` | `http-equiv` |
| `acceptCharset` | `accept-charset` |
| `defaultValue` | `value` — the attribute **is** the initial value; there is no controlled/uncontrolled pair here |
| `defaultChecked` | `checked` |
| `innerHTML`, `textContent` | the element's children |

The refusal is a string literal type rather than `never`, so the error carries the answer:
TypeScript prints the expected type, and the expected type is the advice.

```
Type '"refresh"' is not assignable to type '"write `http-equiv`, with the hyphen, as HTML spells it"'.
```

Kept short deliberately — the error is read in an editor tooltip and on one terminal line, which is
the most cramped place any of this project's prose appears.

Refused rather than aliased on purpose. `class` and `for` are aliased because they are reserved
words, and that rule is complete — nothing here is reserved, and `http-equiv` is writable exactly as
HTML spells it. Aliasing would turn a two-name exception into a list that grows forever.

Zero errors across every app and package in this repository, and the production bundle is
byte-identical: types are erased.
