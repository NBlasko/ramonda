# Security policy

## Reporting a vulnerability

Report it privately, through GitHub:

**[Open a draft security advisory](https://github.com/NBlasko/ramonda/security/advisories/new)**

That opens a thread visible only to you and the maintainer, where a fix can be
prepared and released before anything is public. A regular issue is a public
issue, so please use the advisory form for anything that lets someone else's code
or data do something the author did not intend.

Useful in a report: the package and version, a snippet that shows the behaviour,
and what an attacker gets out of it. A failing test is the fastest possible
report — this repository is a monorepo with the test setup already in place, so a
test that reproduces the problem is a patch waiting to happen.

**What to expect.** Ramonda is maintained by one person. An acknowledgement comes
within a few days; a fix takes as long as the fix takes, and you will hear where
it stands. When it ships, the advisory is published with credit to you unless you
would rather stay unnamed.

## Which versions get fixes

Ramonda is `0.x`: interfaces still move, and every fix lands on the **latest
published version of each package**. There are no backports, because there is
nothing yet that anyone is pinned to.

That changes at `1.0`, when interfaces are held and backward compatibility becomes
a rule. This section will then say which majors are supported and for how long.

## What is in scope

The framework's own handling of data it did not write:

- **Rendering and escaping** — text, attributes and props reaching the DOM, in
  `@ramonda/core`.
- **Server rendering and hydration** — the markup and the serialized state that
  travel from server to client, including how the client trusts them.
- **Router** — path and query parsing, guards, redirect targets.
- **Query** — cache keys and cached payloads, and anything that lets one key's
  data be served for another.
- **Devtools** — the panel runs in development and renders application values;
  a value that can execute there is in scope.
- **`create-ramonda`** — what the generated project contains, and what the CLI
  writes to disk.

Reports about the development toolchain (vite, vitest, tsup and friends) are
welcome too, and they are tracked, but they are weighted differently: those
packages never reach a user's bundle.

## How releases are verified

Every `@ramonda/*` package is published from GitHub Actions with **npm
provenance** — a signed SLSA attestation binding the tarball to the commit and the
workflow that built it. Check it from your own project:

```sh
npm audit signatures
```

`@ramonda/core@0.3.0` and later carry `provenance` under their npm attestations,
which means a tarball that did not come out of this repository's release workflow
cannot claim to be one.

## What runs on every change

- **CodeQL** analyses the TypeScript on every pull request, on every push to
  `main`, and weekly — findings appear under Security → Code scanning.
- **Dependency review** reads what a pull request adds to the dependency graph and
  blocks high and critical advisories.
- **Dependabot** watches the installed tree against the GitHub Advisory Database
  and opens grouped update pull requests weekly.
- **OpenSSF Scorecard** grades the repository's supply-chain hygiene weekly.

The configuration for all four lives in `.github/`, and
`.github/workflows/README.md` explains why each one is shaped the way it is.
