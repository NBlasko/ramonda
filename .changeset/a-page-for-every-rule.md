---
"@ramonda/check": minor
---

`ruleCatalogue()` carries each rule's `advice`

The documentation site builds a page per rule out of it — 84 pages where there was one table — so
the terminal and the page say one thing and neither can drift from the other.

**Deliberately the advice and not the docstring**, although the docstrings are the better prose and
there are 8,751 lines of them. A docstring argues with the PAST: which shape was rejected, what a
measurement disproved, why the obvious fix is wrong. That is right beside the code, where it stops
somebody undoing a decision, and wrong for a reader meeting the rule cold — who does not care what
was, only how it works now. `advice` is already the reader's text.

One rule's advice had to change to earn that: `row-without-a-key` said *"Each line above says which
of the two you are looking at"*, which points at nothing on a page. One of eighty-four, so the
corpus was already almost medium-independent — and a test now keeps it that way, because the next
person writing advice will be looking at a terminal.
