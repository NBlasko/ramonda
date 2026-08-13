---
"@ramonda/core": minor
---

A portal can server-render into any target, not only `document.head`.

`document.head` worked because the server's document has one. Every other container — a modal root in the body — does not exist during a server render: the shell is assembled after the render returns, so there is no element to point at. Those portals were client-only, and a component inside one was rebuilt rather than restored.

`portalTarget("name")` names a target instead of pointing at it. The server collects that target's content into a container of its own and returns it on `page.portals`, keyed by name; `renderDocument` emits a container per entry after the app root, and a hand-rolled shell can place them itself using the exported `PORTAL_TARGET_ATTR`. On the client the name resolves to that container and the block inside it is adopted, anchors and all — so a component in it restores its server state. With no server render, the container is created on demand.

A token rather than a selector string: a selector is a claim about markup the portal does not own, and it fails silently when the shell changes.

`RenderedPage` gains `portals: Record<string, string>`.
