---
"@ramonda/devtools": minor
---

The panel docks instead of covering the app, and you can pick a component off the page.

**Docked.** Opening the panel puts a right margin on the body, so the app reflows into what is
left. That removes a whole class of problem rather than one annoyance: as an overlay, highlighting
a component often highlighted something the panel was covering — which is why the drawer used to
fade after a delay, and a panel that goes transparent while you read it is its own kind of wrong.
The fade and the dimming overlay are gone; nothing is behind the panel to fade. What docking
cannot squeeze is an element the app positions `fixed`, or a layout pinned to `100vw` — browser
devtools has the same limit, and the drag handle is the answer when it bites.

**The picker** (`⌖` in the toolbar) inverts the search: hover the page, the component under the
cursor is outlined and named next to the cursor, and a click focuses it in the tree. You almost
always know what on screen you care about and almost never where it sits in the tree. It captures
on `window` and swallows the press, because Ramonda attaches handlers to elements directly — a
pick must not also submit the form it was aimed at. Escape cancels, and closing the panel or
leaving the tab stops it, so the page is never left with a crosshair and no explanation.

The panel also restores what it borrowed when it is removed from the DOM: the body's margin, the
cursor. An app never removes it, but a test does, and that is where the leak showed up.
