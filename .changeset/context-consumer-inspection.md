---
"@ramonda/core": minor
"@ramonda/devtools": minor
"@ramonda/query": patch
"@ramonda/router": patch
---

A context consumer is no longer an empty node in devtools, and the pair is named Provider/Consumer
throughout.

**What a consumer reads is now visible.** A consumer holds no state and no props — every value it
exposes is an accessor over the provider's signals — so it appeared in the panel as a node with
nothing in it: the emptiest thing in the tree being the hook whose entire job is reading. It now
reports, under `Reads from context`, the keys it is subscribed to with their current values, and
names the keys it has never read.

The catch, and the reason the consumer answers for itself rather than the panel walking its
properties: **reading is subscribing.** A consumer's getter attaches a listener on first read, so a
panel that read every key would silently widen what the owning component re-renders on. Only
already-subscribed keys are read, where the subscribe branch is a no-op. There is a test that
changes a key the consumer never reads and asserts it did not rebuild — inspecting must not change
behaviour, and here the ordinary read does.

Seeing which keys a consumer actually reads is worth it on its own: it is the fine-grained
subscription made visible, the difference between "this one wakes on `color`" and "on anything in
the theme".

**Naming.** The docs already destructured `[ThemeProvider, ThemeConsumer]` while the framework's own
source, tests and playground said `ThemeContext` — and devtools, which labels the hook
`${label}Consumer`, disagreed with the code in front of you. `Consumer` everywhere now. It is also
the more accurate name: the pair is a provider and a consumer, and unlike React's context object
there is nothing here to take a `.Provider` off. Only local destructuring names changed; no API did.
