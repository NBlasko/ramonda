---
"@ramonda/devtools": patch
---

The devtools documentation has pictures now, and they are generated rather than taken.

Six of them — the docked panel with a component focused, the picker naming a row on the page, one value
open on the whole panel, the Query tab, the profiler recording, and a GIF of the badge detonating, which
is the one thing in the panel a still cannot show.

They come from `apps/docs/scripts/shots.mjs`, which starts the playground, drives a real Chrome over the
DevTools Protocol and writes the files. Nothing was installed for it: Chrome is on the machine, `ffmpeg`
is on the machine, and Node has had a global `WebSocket` since 22 — which is the whole dependency list.
A hand-taken screenshot of a devtools panel is out of date the first time the panel changes and nothing
tells you, because a picture cannot fail a build; regenerating these is `npm run shots`, so a panel that
no longer matches its documentation shows up as a diff.

Captured at 2× so the panel's 13px monospace survives, then written as WebP at 1600 wide — 76 kB rather
than the 360 kB PNG it started as, for pixels a documentation column can actually use.
