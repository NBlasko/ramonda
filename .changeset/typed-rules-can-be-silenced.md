---
"@ramonda/css": patch
---

The two typed rules can be told they are wrong, like every other rule.

`style-prop-never-used` and `style-prop-overridden` honoured neither escape hatch. Every rule in
`rules.ts` gets both for free — `checkBlock` drops the ones a config silenced and `checkedSource`
drops the ones a directive covered — and these two take neither path, so they could not be switched
off at all.

Both now work:

```ts
export default { rules: { "style-prop-never-used": "off" } };
```

```tsx
// ramonda-css-ignore the prop is spread by a wrapper this file cannot see
props: { css?: CssBlock },
```

And the directive works in a file holding NO block, which is the ordinary shape for a component that
only hands its prop on — those files are in none of the maps the block pass fills, so their
directives are now read when there is something to say about them.
