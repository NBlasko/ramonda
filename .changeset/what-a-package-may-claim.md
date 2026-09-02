---
"@ramonda/check": minor
---

`--certify` — what a package may claim about the graph it ships

Every package already ships its graph: `ramonda.graph` in `package.json` points at a fragment, an
app splices it in and WALKS it, and the fragment fingerprints the declaration file it describes so a
stale one is refused rather than trusted. What was missing is the other half — how much of that map
can be believed.

```
[ramonda-certify] @ramonda/router 0.11.0

  Covers 6 component(s) and hook(s), 4 of them exported.

  ✓ complete  every component it names, it can follow
  ✓ plain     nothing needed an exemption written beside it
  ✓ quiet     no rule warns about anything it ships
  ✓ current   the graph fingerprints the declaration file it ships
```

**There is no score, and that is the design rather than a simplification.** A number tells a
publisher where they stand and nothing about what to do; the honest answer to *how far should I go*
is a list that gets shorter. So an unheld claim comes FIRST and carries the work — the file, the
line, and where a hole has a spelling to suggest, what to write instead, which the analyzer already
produces for every hole it records.

**The graph ships either way.** A certificate that gated it would give a publisher who cannot
qualify a reason to ship nothing at all, and the consumer would lose twice: no map AND no warning.

**Three things the measurement found, each of which would have broken it:**

- **Claims must be scoped to the package's own files.** Before that filter, `@ramonda/form`,
  `@ramonda/query` and `@ramonda/router` each reported two written exemptions — and all six were the
  same two lines in `@ramonda/testing-library`, dragged into their programs by their test files.
  Three packages would have carried somebody else's excuse.
- **Scoping by path PREFIX is not the same question**, and it is the one that looks right.
  Everything under `app/node_modules/@acme/ui` is "inside" the app by string. What decides is the
  file's own nearest `package.json`, so the fixture puts the faults in a package NESTED inside the
  certified one.
- **A package with nothing in its graph prints no claims at all.** Every one would hold — there is
  nothing to fail them with — and a tick reads as approval whatever sentence sits beside it.
  Measured: `@ramonda/lens`, `@ramonda/server` and `@ramonda/build` would each have printed four,
  making *ship no components* the cheapest route to a perfect certificate there is.

An APP gets the report with its subject named rather than withheld: nobody installs an app, so the
claims are for its author and not for a consumer.

**What it cannot do, and it is written into the module.** A publisher writes their own graph, so
nothing here proves that graph is a truthful reading of the source; `current` proves it matches the
declaration file SHIPPED, which is a smaller claim than it looks. What makes a certificate earned is
that a third party can REPRODUCE it — npm provenance attests which commit and which public workflow
built a tarball, and from there anyone can run this command on that commit and compare. Trust the
process, not the file.
