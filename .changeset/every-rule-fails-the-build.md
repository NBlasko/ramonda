---
"@ramonda/check": minor
---

Every rule fails the run, and there is a documented way to say "not here"

`ramonda-check` had **nine errors and seventy-seven warnings**, and seventy-two
of the warnings said in their own advice that they would become errors "in a
later version". Nothing was tracking that, and a version that keeps saying it is
a version that has decided not to.

**Every rule is an error now.** The promise is kept rather than repeated, and the
sentence that made it is gone from all seventy-two.

**Because a warning that never fails anything is worse than an error with an
escape hatch.** A warning is ignored in silence and nobody knows it was. An
exemption is written down:

```tsx
// ramonda-check-ignore this div is a backdrop; the real exit is the button beside it
<div className="scrim" onclick={this.close} />
```

That mechanism already existed and was not documented anywhere. It goes on the
line the report names or the line above it, it works for every rule, **the reason
is mandatory** — an empty directive silences nothing and is itself reported — and
every annotated site is printed back on every run. A reason that has stopped
being true cannot sit there unread.

**The CLI no longer has two report loops.** One printed warnings and one printed
errors, and with nothing warning, `tsc` refused the first as provably dead. They
are one loop that prints every rule that reported; severity decides the exit
code, through `failingRules`, and nothing else. A filter would have had one arm,
and the arm it dropped is the one a future warning rule would land in — which
would then report nowhere at all.

**The certificate loses a claim, from four to three.** `quiet` said "no rule
warns about anything it ships", and nothing warns any more, so it is a claim
nobody can fail — which is the bar the certificate's own source sets for whether
a claim is worth printing. What it was reaching for is what `plain` already
says: nothing needed an exemption written beside it. `ClaimId` is
`"complete" | "plain" | "current"`.

**And the cost landed exactly where the documentation said it would.**
`row-without-a-key` was the one rule that reports on correct code — an inferred
identity that works — and as an error it failed this repository's own
documentation app in seven places. Six had an identity to write down and now
write it; one is a table row that is an array of cells and carries none, and it
carries the directive instead. One of the six was a real fault: a comment in the
search box claimed "keying by URL keeps those rows" beside code that keyed by
nothing and worked only because the inference agreed with it.

A `minor`, because pre-1.0 a breaking change is a minor. Nobody is on this yet,
which is the argument for doing it now rather than at 1.0: promoting a rule is a
breaking change, and the cheapest moment for one is while there is nobody to
break.
