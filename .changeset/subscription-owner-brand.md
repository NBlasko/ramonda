---
"@ramonda/core": patch
---

A subscription decorator applied to the wrong kind of class now says so.

`createSubscriptionDecorator`'s owner requirement was expressed as `This extends Owner` on
the returned decorator. It worked — a class that did not satisfy the `connect`'s owner type
was rejected — but the message was about `access.has` being contravariant and about the
decorated method being missing from the owner type. True, and unreadable.

It is a brand now, the same shape `@StableProps` uses for its prop names, so the failure
lands on a named property and the message carries the owner type that was required.

Also documented, because nothing said it: annotating `connect`'s `owner` parameter is how a
decorator demands something of the class it goes on, and it gets the concrete instance —
`(owner: Component<{ id: string }>, …) => store.subscribe(handler, owner.props.id)`. Leaving
it unannotated makes the decorator work on any component or hook, which is what the built-in
ones do. Three tests now lock all of it, including the one thing that does NOT work: the
decorated method's parameters still need annotating (TS7006), for the same TypeScript reason
`@watchProp`'s do.
