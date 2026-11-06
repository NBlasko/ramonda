---
"@ramonda/router": minor
---

The hash is read the way the query is, and a key can own what is written below it. `nav.hashParams` is `#a=1&b=2` → `{ a: "1", b: "2" }`, `updateHashParams` changes it, and `HashParamsUpdater` is its type — replacing `hashTags`, `updateHashTags`, `HashTag` and `HashTagsUpdater`, whose hash held one pair per `#` segment: `#access_token=…&state=…`, the shape an OAuth redirect hands back, kept the first pair and dropped the rest without a word.

`<HashLevel of="nav">` says that what is written to the hash inside it belongs to the key `nav`: `#nav=video#nav:tab=comments`, each `#` segment after the first naming its owner before a `:`, and `&` between its keys. A change to a key clears what it owns, at every depth, and nothing another key owns, so switching `nav` takes `tab` with it and leaves a sibling `<HashLevel of="panel">` alone. A component does not know its parent; the parent says it where it places the child, and the owners live in the URL, so a reload and Back keep them. `updateHashParams` hands its updater the caller's own keys, and `hashParams` reads the caller's own line: the top and every owner down to its own, the nearer winning a key both use, and no sibling's keys.

A bare `#install` is `{ install: "" }`, the name of a section, and is written back bare. A component re-renders on a hash change only if it reads `hashParams`, as with `searchParams`.

To move: `nav.hashTags.find((t) => t.key === "tab")?.value` is `nav.hashParams.tab`; `updateHashTags([{ key: "tab", value: "film", level: 0 }])` is `updateHashParams({ tab: "film" })`, and a tag at `level: 1` is written from a component inside `<HashLevel of="…">`, under the key it belongs to. `RouterState` has `hashScopes`, one record per owner, in place of `hashTags`. A page the previous version baked or cached still hydrates: its state is read as an empty hash until the URL is read on mount.
