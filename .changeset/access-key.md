---
"@ramonda/check": minor
---

A new rule: `access-key`.

`accessKey` binds a character to an element, and the character is not the page's to give. Browsers
already bind most letters, and so does every screen reader — the software of the people most likely
to be using keyboard shortcuts at all. One page's `accessKey="s"` overrides that binding, on that
page only, with nothing to discover it by and no way to switch it off.

It also cannot be got right, which is what makes it a rule rather than a preference: the modifier
differs by browser and platform, the conflicts differ by screen reader, and nothing announces the
binding — so the page cannot even tell the reader the shortcut is there. Where a shortcut really is
wanted, own it: a key handler the page documents on screen, which can be listed, chosen around the
common bindings, and turned off.
