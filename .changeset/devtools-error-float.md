---
"@ramonda/devtools": minor
---

An error no longer reflows the app it happened in.

Docking squeezes the page, which is right when you open the panel yourself. But the panel also
opens **itself** on a dev error, and there squeezing is destructive: the app reflows, a media query
flips, and the layout you are shown is not the one the error happened in. The tool changed the
evidence by arriving.

So an error-triggered open **floats** — the panel covers the page and nothing about the app's layout
changes. It is the one case that needed the old overlay behaviour, and what that overlay was really
providing was "does not reflow", so that is what floating is; the dimming is not back, because
dimming the app you are debugging was never the useful part. A `dock`/`float` button in the header
switches, remembers your choice for manual opens, and a line under the header says why the panel is
floating when you did not choose it.

An error arriving while the panel is already open changes nothing at all — reflowing on the second
error would destroy the layout you are in the middle of reading.

Also fixed: a panel removed from the DOM went on reacting to `ramonda:dev-log`, `ramonda:tick` and
the rest, so a dead panel could open itself and write a margin onto the live document's body.
