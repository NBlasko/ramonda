---
"@ramonda/css": minor
---

**Breaking: a project's tokens are called tokens.** CSS calls a custom property a "variable", so a
config holding `variables` beside settings about custom properties read as one thing said twice.
Every old name is refused with the new one in the message.

| Was | Is |
|---|---|
| `variables: { $color: kind(…) }` | `tokens: { $color: kind(…) }` |
| `alsoSets: ["--x"]` | `externalCustomProperties: ["--x"]` |
| `"<color>": { variablesOnly: true }` | `"<color>": { hardcoded: false }` — the value turns over |
| rule `literal-not-allowed` | `hardcoded-not-allowed` |
| rule `unknown-variable` | `unknown-token` |
| rule `variable-by-hand` | `token-by-hand` |
| rule `variable-set-against-its-declaration` | `token-set-against-its-declaration` |
| rule `variable-set-by-another-name` | `custom-property-set-by-another-name` |
| rule `hole-as-a-variable-name` | `hole-as-a-custom-property-name` |
| `css-system/variables.css` | `css-system/tokens.css` |
| `ColorVar`, `LengthVar`, … · `Var<K>` · `VarByKind` | `ColorToken`, `LengthToken`, … · `AnyToken<K>` · `TokenByKind` |
| `Variable` from `@ramonda/css/config` | `TokenDeclaration` |

Run `ramonda-css codegen` once after updating: it writes `tokens.css` and removes the old
`variables.css` it wrote (one somebody wrote by hand is left alone). An import of
`css-system/variables.css` in your own code becomes `css-system/tokens.css`. The docs page moved to
`/style-blocks/tokens`; the old address redirects.
