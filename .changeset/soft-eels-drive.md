---
"@ramonda/core": patch
---

Two list items under one key no longer leak the shadowed item's subscription

Each item in a `list()` gets a reactive scope, stored under its key. When two items produce the SAME
key, the second one's scope overwrote the first in the map being built for that pass — after the
first had already subscribed to everything its mapper read. It was then in neither map: gone from
this pass's, never in the previous pass's, so the cleanup loop that detaches the scopes which did not
carry over could not reach it.

A live subscription with no owner. Every change to a signal that shadowed mapper had read went on
calling `reBuild()` on the list's owner for an item that no longer exists, for the life of the page,
and marked the engine dirty each time — which defeats the whole-list skip as well.

Duplicate keys are user error and DEV reports them (RMD013), but the leak was production behaviour,
and a warning does not detach a listener. A scope that is displaced under a key is now released. The
surviving item's subscription is untouched, so a list with distinct keys behaves exactly as before.
