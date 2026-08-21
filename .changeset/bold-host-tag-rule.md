---
"@ramonda/check": minor
"@ramonda/dom-facts": minor
---

New rule: `host-tag-is-not-an-element` — a `@Host` tag that names nothing the DOM has.

The host element is what a component IS: every attribute it takes, what `@onElement` binds to, and
the box its children land in. `@Host("dvi")` produces `<dvi>` — `createElement` accepts any name, so
nothing throws, the DOM contains it, and it renders as an unknown inline element that looks almost
right until a layout is put on it.

**Three ways a tag is fine, and they are the whole set:** an HTML element, an SVG element by name AND
case (`clipPath` is the element, `clippath` is not), and anything with a DASH — the standard's own
marker for a custom element, so `<my-widget>` is deliberate and never reported.

**The tag is read through a NAME.** `@Host(TAG)` where `const TAG = "dvi"` is the same host as
`@Host("dvi")`, including from another file. A tag CALLBACK — `@Host((p) => p.as ?? "div")` — is
computed from props and has no single answer, so it is not judged; core says the same of it and
re-checks what it returns on every call.

**Why a static rule when core already checks.** `assertHostTag` is `__DEV__`-only and fires when the
class is DEFINED, which for a component behind a route nobody opened is never in the build that
ships. It also judges only the SHAPE of the name: `dvi` passes its pattern happily.

`@ramonda/dom-facts` gains `htmlElements`, the other half of `svgElements`. Generated from core's
`JSX.IntrinsicElements` rather than from a specification, because what makes a name an element here
is what the framework accepts — and pinned to it in both directions by `HtmlElementNames.test.ts` in
core, exactly as `SvgNamespace.test.tsx` pins the SVG list.

Only the checker reads it today, and it is shared anyway: the moment core wants to ask the same
question in a dev diagnostic, the alternative is a second copy of these 116 names — which is the
failure that package exists to prevent, and the SVG note in it is the record of that happening.

**What the rule can and cannot read, measured.** A literal, and a name — including one from another
file. NOT a tag callback, which has no single answer, and NOT a prop the call site supplies to one:
`<Card as="dvi" />` with `@Host((self) => self.props.as ?? "div")` stays silent, because the answer
would differ per call site while this reports once per class.

Zero findings across every project here, measured against 861 `@Host` tags.
