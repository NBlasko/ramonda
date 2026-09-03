---
title: Upgrading
description: What a Ramonda version number promises before 1.0, why a minor can break you, and how to move between versions without being surprised.
section: Reference
order: 115
---

# Upgrading

Ramonda is before `1.0`, and that changes what a version number means. This page says what it
means, and what to do about it.

## A breaking change ships as a minor

`0.23.1` → `0.23.2` is a patch, and a patch never asks you to change your code.

`0.23.1` → `0.24.0` is a minor, and a minor **may**. Before `1.0` that is where a breaking change
goes — not into a major. `1.0` is the version that declares the framework stable, so spending it on
an ordinary change would say something that is not true yet.

The consequence for you is one sentence: **the version number tells you a change is possible, and
only the changelog tells you what it is.**

## Nothing upgrades you across one by accident

The range in your `package.json` already stops it. `create-ramonda` writes a tilde — a project
scaffolded against `0.23.1` gets `"@ramonda/core": "~0.23.1"` — and for these versions a tilde and a
caret come to the same thing: `~0.23.1` and `^0.23.1` both resolve to `>=0.23.1 <0.24.0`.

Patches arrive, the next minor does not. `npm update` and `pnpm update` resolve within the range
they find, so they keep you on the line you are on, and moving to `0.24` is something you do by
naming it.

## Move the `@ramonda/*` packages together

These packages do not share a version line: core is on one number, the router on another, forms on
a third, and a release of one says nothing about the others. What ties them is a peer dependency:
`@ramonda/form`, `@ramonda/router` and `@ramonda/query` each accept a core in the range
`>=0.1.0 <1.0.0`, which is every `0.x` there is.

So **nothing objects** if you take core to `0.24` and leave the others built against `0.23`. The
range is satisfied, your package manager has no complaint to make, and there is no version check at
runtime either.

Upgrade them in one step, then — whichever of these your `package.json` actually has:

```sh
npm install @ramonda/core@latest @ramonda/router@latest @ramonda/query@latest \
            @ramonda/form@latest @ramonda/lens@latest @ramonda/server@latest
npm install -D @ramonda/build@latest @ramonda/check@latest \
               @ramonda/devtools@latest @ramonda/testing-library@latest
```

## Read the changelog for the minor you are moving to

Every package keeps its own, one file each, in the repository:
[`packages/core/CHANGELOG.md`](https://github.com/NBlasko/ramonda/blob/main/packages/core/CHANGELOG.md)
and its neighbours.

Entries are grouped under **Minor Changes** and **Patch Changes**, which is the semver word rather
than a promise about your code — a breaking change is under *Minor Changes* along with everything
else. **An entry that breaks something says so**, in bold, and then says what to write instead.

Skipping several minors at once means reading each one you pass. There is no combined note for a
range of versions, and the entry that affects you may be two releases back rather than in the one
you are moving to.

## Then run the checker

`ramonda-check` ships with the version you installed, so upgrading it brings whatever it learned to
report in the meantime. Running it after an upgrade is the cheapest way to find code the new version
is unhappy with, and it reads your source rather than running your app, so it sees branches your
tests did not open.

```sh
npx ramonda-check
```

See [checking your app](/reference/check).

## What `1.0` will change

From `1.0` the interfaces hold: backward compatibility becomes a rule rather than a courtesy, and
version numbers go back to meaning the ordinary thing — a major may break you, a minor may not. The
point of these `0.x` releases is to arrive at an API worth keeping, because the way it works then is
the way it goes on working.

## Next

- [Checking your app](/reference/check) — what `ramonda-check` proves that a running page cannot.
- [The build](/reference/build) — the decorators need a build step, and this is what configures it.
- [Something is wrong](/symptoms) — if the upgrade left you with a symptom rather than a message.
