# What a page owes its reader

Every page in `content/` is judged against this. It is a checklist rather than advice because
"write it well" is not something two people can disagree about usefully, and this is.

Four of the six questions are the ones the framework's author asks when reading a page cold. The
other two are about where the page SITS, which no amount of good prose fixes.

---

## 1. Does it name everything it uses?

A page is good for somebody new when every term in it is either **explained here** or **linked to
where it is explained**. Not "written simply" — named.

**The test, and it is mechanical:** list the nouns the page uses that belong to this framework —
`@state`, a hook, a region, hydration. Each one is defined on this page, or is a link. A term that
is neither is a page that assumes a reader it never asked for.

The commonest failure is not a hard word. It is a word the author has stopped seeing.

## 2. Is the subject covered, or only introduced?

A page about a thing owes three answers, and most pages give the first only:

- **What it does**, and how to write it.
- **What it refuses**, and what happens when you do it anyway. A reader meets the refusal before
  they meet the feature — that is what an error message is.
- **What it costs**, and when NOT to reach for it. A page that only recommends is an advertisement.

**The test:** open the source. Every exported name, option and failure mode on the thing this page
is about is either on the page or deliberately somewhere else. "I did not think of it" is the
answer this catches.

## 3. Is anything read before it is explained?

Clarity is hard to argue about; ORDER is not.

**The test:** read the page top to bottom and mark every sentence that needs a fact appearing later.
Each mark is either a forward link or a reordering. Zero marks is the bar.

## 4. Is the example the smallest one that makes the point?

An example carries two things: the point, and everything it took to get there. The second is cost.

**The test:** delete a line. If the point still lands, the line was decoration — a prop nobody
reads, a wrapper nobody needs, a second feature borrowed to make the first look real. Put it back
only if its absence changes what the reader learns.

A reader copies the example. Everything in it is a recommendation, whether or not it was meant as
one — which is why `ramonda-check` runs over every block on this site.

## 5. Does the thing have a place of its own?

**A concept the documentation talks about needs its own page**, with its own title and its own URL.
It may — and should — be mentioned in passing wherever it is relevant. What it may not be is
mentioned ONLY in passing.

**Why a page and not a heading.** The site's own search is Pagefind and indexes the full text of
every page, so a passing mention is already findable HERE. Outside is the difference: a search
engine ranks and shows a PAGE. `watchProp` in the middle of a page about state is invisible to
somebody who typed the word into Google, and that is the reader this rule is for.

**The test:** type the name into a search engine with the framework's name in front of it. If the
honest answer is "they would land on a page about something else", it needs its own.

Not every name earns one. A TYPE that only describes the shape of an option belongs as an anchor on
the page that owns the option. The question is whether a reader would ever search for it alone.

## 6. Does the reader know where to go next?

A page that ends is a page a reader leaves. Every page names what to read next and why — not a list
of links, a sentence about which one is theirs.

---

## The voice rule, and it is the one most often broken here

**A page describes how the framework works NOW. It never describes the change.**

This repository writes long docstrings that argue with the past — *this was X, measured, and became
Y* — and that is correct IN THE SOURCE: it is what stops the next person undoing a decision for the
reason it was already rejected. On a page it is wrong. The reader did not know about X, does not
care that it changed, and is now carrying a fact they cannot use.

One fact, two places, two voices. When a docstring becomes a page, the argument with the past comes
out and only the present is left.

**The test:** search the page for the past tense about the framework itself — *used to*, *no longer*,
*was changed*, *now*. Each one is a sentence written for somebody who was already here.

The exception is a MIGRATION page, whose whole subject is the change. It says so in its title.

---

## What this checklist cannot do

It cannot tell you whether a page is clear to somebody who has never seen the framework, and
neither can its author — knowing the answer is what makes the question unanswerable. Questions 1
and 3 are the closest mechanical stand-ins: a term nobody defined and a fact used before it arrives
are what "unclear" usually turns out to be.

The real answer is a reader who is not us. Until there is one, these are the proxies.
