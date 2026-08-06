---
"@ramonda/form": minor
---

`RMF001`, `RMF002` and `RMF003` are records, and the two refusals stay refusals

All three now reach [the collector every reporting package shares](https://ramonda.pages.dev/reference/diagnostics#capturing-them),
so a devtools panel shows them and `installDiagnostics` can take them elsewhere.

**Two of the three are not diagnostics, and the port keeps that straight.** Assigning to a field and
asking a non-list field for its rows **throw**, in every build, because there is no correct program in
which either does something. For those, development adds the record and nothing else: printing as well
would make development noisier than production for a fault whose message is already in front of the
reader. `RMF003` is the opposite — nothing throws, the form has let go of the failure, and the console
line is the only trace, so it prints.

The thrown messages name the package now, `[Ramonda form RMF001] …`, and the sentence itself is
unchanged. Both still throw with `__DEV__` false, which the production suite asserts.

`RMF003` keeps handing the console the **Error object** and not just its message, because a console
given the Error prints a stack a reader can click. That object deliberately does not enter the record:
a collector keeps a bounded history, and an Error holds its stack, which holds the scope it was thrown
from — one of those in a vault keeps a whole submit alive. The record carries the message as text
instead. An existing test caught that distinction being flattened during the port, which is why it is
now written down where the code is.
