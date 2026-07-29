---
"@ramonda/devtools": minor
---

The panel remembers how you set it up, and where you were.

Two stores, because these are two different kinds of thing:

- **`localStorage` — preferences.** Width, docked or floating, and the two toolbar filters (hide
  state & props, hide hooks). That is how you like the tool; it is the same tomorrow.
- **`sessionStorage` — the debugging session.** Whether the panel is open, which tab, the name you
  were filtering for, and the component you had focused. That is where you are in one piece of
  debugging: a reload in the middle of it is part of the session, not an interruption to recover
  from. It ends with the tab, which is right — a focused path names a tree that no longer exists
  elsewhere, and nothing is written to the URL, so a devtools session cannot follow a shared link.

A toolbar button's label follows its stored state, so it never says "hide" while the thing is
already hidden.
