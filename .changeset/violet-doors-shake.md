---
"@ramonda/core": patch
---

Eight typed SVG tags were created as HTML elements

`<tspan>`, `<textPath>`, `<foreignObject>`, `<image>`, `<desc>`, `<metadata>`, `<mpath>` and
`<switch>` were declared in the JSX types but missing from the `svgElements` set the runtime uses to
decide a namespace. SVG-ness is decided by tag NAME, not by tree context, so those eight were built
with `createElement` — an unknown HTML element wearing the tag's name — even inside an `<svg>`.

It failed silently. `createElement` accepts any name, the node is in the DOM, `querySelector` finds
it, `textContent` reads back; it simply never renders as SVG, and `foreignObject` / `textPath` also
lost their camelCase, which is part of an SVG element's identity. `<svg><text><tspan/></text></svg>` —
the ordinary way to place a second line of SVG text — was affected.

The eight names are now in the set, and `SvgNamespace.test.tsx` pins the runtime set to the JSX
declarations in both directions, so the two lists cannot drift apart again.
