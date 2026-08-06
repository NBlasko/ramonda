---
"@ramonda/check": patch
---

A duplicate single-use decorator names the declaration that is actually in effect

The report said "the last wins" for every one of the four decorators it watches. That is true for
`@catchError`, a MEMBER decorator, and false for `@ShouldUpdateOnPropsChange`, `@Host` and
`@StableProps`, which are CLASS decorators — so on three of the four it pointed at the line that works
and told you to delete it.

One rule underneath both: the declaration applied last is the one that stands. A member decorator
initialises top to bottom, so the **lowest** is applied last. A class decorator applies bottom-up, so
the **highest** is. Measured in `@ramonda/core` — `CatchErrorDecorator.test.tsx` watches which handler
receives the error, `PropsGateInheritance.test.tsx` watches which gate is asked — because the two
directions are opposite and neither is guessable from reading.

`DuplicateDecoratorIssue` therefore carries `kind: "class" | "member"`, read off the node the decorator
was found on rather than from a table of names: `@ShouldUpdateOnPropsChange` was a member decorator
before it was a class one, and a table would still be saying so.
