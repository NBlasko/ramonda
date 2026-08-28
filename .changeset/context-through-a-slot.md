---
"@ramonda/core": patch
---

Test only: a slot reads the context it lands under

Two rules that had never met in a test. A slot **belongs where it lands, not where it was written** —
that is what decides its lifecycle order and its depth — and context is looked up the component
tree. Together they settle a question neither answers alone, and the answer is the one the design
intends: a reader written inside one provider and handed to a component that provides something else
reads the one it **lands** under.

Five cases, including the one that looks like the opposite answer and is the same rule: when the
landing component provides nothing, the search keeps climbing and reaches the writer — which is on
that path because it rendered the landing component. Nothing about where the JSX was typed changes
what is found.

No behaviour changed. `Context.ts` already carried the rule as a measurement; nothing had pinned it,
and planting a broken context chain fails four of the five.
