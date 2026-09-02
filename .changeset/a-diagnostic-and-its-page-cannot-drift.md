---
"@ramonda/core": patch
---

**A diagnostic and the page it sends you to cannot drift apart any more.**

Nothing compared the words a diagnostic PRINTS against the words that document it. Only the code was
checked, so a section could go on describing a different fault entirely: `RMD041` drifted until the
message blamed a decorator that had been removed while the reference blamed a selector the framework
never had — two convincing, incompatible explanations of one code.

Three surfaces now have to say the same sentence, and it is the shipped `title` they are compared
against, because that is the one with a right answer: the words the reader just saw in the console.
The advice PROSE is deliberately not compared — a reference page is meant to explain at more length
than a console line, so a gate over the paragraphs would be either wrong or ignored.

- `DiagnosticsRegistry.test.ts` pins core's own `DIAGNOSTICS.md`, both its Codes table and each
  single-code section heading. The `RMD033–RMD040` section covers eight codes and is exempt; the
  exemption is a shape rather than a list, so a heading in neither shape is reported instead of
  quietly escaping.
- `apps/docs/scripts/check-api-coverage.mjs` pins the site's `reference/diagnostics.md` headings,
  reading the registry rather than a second list.

Measured before writing it: 6 of 52 table rows, 15 of 29 section headings and 9 of 52 site headings
described their code in different words. All of them now read as the code reports.

`RMD009`'s title says `Update loop: a component never stopped re-rendering` — a colon where it had an
em dash, so the sentence survives being written as a heading, and so it matches the production
counter's own wording in `Task.ts`.

Named limits: `lens`, `query` and `form` carry no `title` in their spec tables — their message is
written at the call site, so one code has several, and there is nothing single to compare a heading
against. Their headings are still guarded only by existing.
