---
title: No global state
description: Why there are no module-level stores, and what that buys on the server.
section: Why Ramonda
order: 124
---

# No global state

You can't reach a Ramonda store, or the router, from module scope — there is no
`import { router }` you can call `push` on from anywhere, and no global place to stash
app state that any component reads. State lives on component and hook instances, and it
is reached through the tree. This is deliberate.

## The reason is the server

On a server, one module is shared by every request being handled at once. A value in
module scope — a store, a "current user", the router's current URL — is therefore
shared across visitors. Two requests in flight would read and overwrite each other's
state, and the bug would be intermittent, invisible in development (where you test one
request at a time), and would appear only under real traffic.

So there is nowhere global to put per-request state, because there is no such thing as
per-request state in a place every request shares. Keeping state on the tree — which is
built fresh for each render — makes a whole class of "why did this user see that user's
data?" bug impossible rather than merely discouraged.

## The router is a hook, not a singleton

This is why the [router](/routing) is a hook you add with `this.use(Router)` rather
than a global you import. The route state lives on the tree like any other state;
navigation is reached through `Navigator` from inside a component, not from a free
function. If a plain function needs to navigate, you pass it a callback — the component
calling it has the hook.

The cost is honest: you can't `push` from an arbitrary utility module. In exchange,
everything is connected to the tree, easy to trace, and safe to render concurrently on
a server.

## What this asks of you

Not much, in practice. Share values down the tree with [props](/concepts/props) or
[context](/composition/context); keep behaviour reusable with [hooks](/hooks). It is
the same discipline that keeps the server safe and the client easy to follow — one
rule, both sides.
