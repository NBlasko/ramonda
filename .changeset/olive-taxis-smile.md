---
"@ramonda/core": patch
---

A wide update no longer costs O(n²) before anything renders

The build queue is kept depth-descending, and a component was placed in it by scanning from the front
until it found its spot. That made the ordinary case the worst one: a parent handing new props to N
children queues N components at the SAME depth, and each of them walked the entire queue to reach the
end. The scan happened before a single component had rendered.

Measured, inserting N same-depth components: 1000 → 1.5 ms, 5000 → 13.4 ms, 10000 → 54.4 ms, 20000 →
216 ms. With a binary search: 0.3, 0.3, 0.4, 0.7 ms. On a mixed-depth batch of 20000 — where the
splice's own memmove is the rest of the cost — 132.8 ms → 12.0 ms.

Nothing else changed. It is the same array in the same order: the search stops after every entry of
the same depth, exactly where walking past them landed, so the queue is built as it always was and
the drain is untouched. `TaskQueueOrder.test.tsx` pins the ordering that had to survive — parents
before children, depth never going backwards across a wide mixed-depth batch — and passes against
both the old scan and the new search.
