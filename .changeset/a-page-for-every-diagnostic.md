---
"@ramonda/docs": patch
---

A page for every diagnostic, and for every rule

Two pages carried 158 subjects between them: 84 checker rules in one table, and 74 runtime
diagnostics in one file of 1,845 lines. That is one URL for 158 questions, which is one search
result for 158 of them — and a reader whose build printed `RMD003` types `RMD003`.

The rules are generated from the rules themselves, the diagnostics are split out of the file that
already documented them. Neither is hand-maintained: 158 pages written by hand are 158 things that
go stale, and this site has already proved that happens — the rule table was nine rows out of date
the day the rules landed beside it.

**The split also removes a fragility the link test was written for.** An anchor into that page was
the whole heading — `#rmd003-context-consumed-without-a-provider-above-it` — so rewording a title
broke every link into it, which is how twenty-two of them died at once.
`/reference/diagnostics/rmd003` cannot break that way, because a code is never reused and never
changes. The 80 anchor links in the documentation were rewritten to it.

76 pages before, 235 after.
