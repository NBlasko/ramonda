---
"@ramonda/core": patch
---

`Head` gives back a tag the page author wrote, instead of deleting it.

The registry adopts a matching element rather than adding a second one beside it — which is right,
and the reason a page whose `index.html` already has a `<meta name="description">` does not end up
with two. But it then **removed** that element when no page asked for it any more, whether it had
created it or merely borrowed it. The author's tag was gone from the document for good.

`title` never did this: the registry captures `originalTitle` when it is made and puts it back. The
tags simply never got the same treatment, which is what makes this a fault rather than a design —
measured, a `<title>` came back as `from index.html` while the description beside it was gone.

An element is the author's when it does **not** already carry Ramonda's marker. One that does was
written by this framework on the server and adopted on hydration — the marker is how `collectHead`
found it to serialize — so it belongs to the page and still goes when the page does. Two hydration
tests say exactly that, and they were right; what was wrong was that one of them stripped the marker
its own server render emits.
