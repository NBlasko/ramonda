---
"@ramonda/core": minor
---

Ten messages become diagnostics: `RMD032` to `RMD041`

Each of these was a `ramondaLog` call with its advice written inline — a real fault, reported, but with
no stable name to search for, no `fix` a panel could show apart from the message, and no way for a
collector to group two occurrences of one cause. They are now codes like every other, which means they
reach the record channel as well as the console.

| | |
|---|---|
| `RMD032` | state that cannot cross to the client — a function, a class instance, a `Map` |
| `RMD033` | state written during create or mount, which the client never receives |
| `RMD034` | the client's hook tree does not match the server's |
| `RMD035` | the state blob could not be read |
| `RMD036` | an object among JSX children that is not markup |
| `RMD037` | a `@watchProp` selector threw |
| `RMD038` | `class` where `className` was meant |
| `RMD039` | more than one `@shouldUpdateOnPropsChange` |
| `RMD040` | a listener with no target |
| `RMD041` | the default host cannot be the direct target of this event |

**They are deduplicated by source now**, where before they reported per occurrence: a component with
six unserializable fields printed six lines and now prints one per field, which is what "once per
source, not once per occurrence" has always meant everywhere else in this package.

**The severities are the ones the messages already carried.** The port gives them identity; it does not
re-judge them. Two of the ten sit at `error` because the result is wrong — a dropped child, a selector
returning a value nobody chose — and the rest warn.

The advice moved out of the message and into each code's `fix`, so a panel renders it apart from what
happened, and every one has a section on the reference. `RMD026`, retired in this package's own
registry since August, finally has a retired section there too — a reader who hits it in an old build
now lands somewhere.

**One message deliberately keeps no code.** `bootstrap`'s "App crashed" is the app's own error on its
way up, rethrown on the very next line so whoever threw it still gets it with its real stack. Every
code names a mistake and carries a fix; this one cannot, because the framework knows nothing about the
fault beyond having been in the call stack. The reason is now written where the code is.
