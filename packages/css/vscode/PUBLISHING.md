# Releasing this extension

`ramonda.css` is live. This is how a new version reaches it.

## The four steps

From the repository root:

1. **Bump `version`** in `packages/css/vscode/package.json`.

   Nothing bumps it for you. The extension is deliberately outside `changeset`, because its version
   and the npm packages' versions answer different questions — an extension is released when its
   grammars, formatter or diagnostics change, and `@ramonda/css` is released when its API does.
   Tying them together would publish an unchanged extension on every patch of anything.

   Pre-1.0, the same rule the packages use: anything a user would notice is a **minor**, a fix is a
   **patch**. Colouring that starts matching something new is a minor; a scope that was wrong is a
   patch.

2. **Write the entry at the top of `CHANGELOG.md`**, under `## <the same version>`.

   Not bookkeeping. It is the extension's second tab on the marketplace page, and it is the only
   thing that tells somebody with it installed what they are about to get. The packager refuses to
   build if the top heading and the manifest disagree — which is the one place a human writes the
   version twice, and therefore the only place a typo can be caught.

3. **`pnpm extension:package`**

   Writes `packages/css/vscode/ramonda-css-<version>.vsix` — about 41 KB, twelve files — and deletes
   any older bundle beside it, because a stale `.vsix` is the easiest wrong file to upload. It is
   gitignored (`*.vsix`); nothing about it is ever committed.

   It refuses to build rather than build something broken. What it checks is what the test suite
   cannot: that the manifest still points at files that exist, that each grammar's `scopeName`
   matches the one it is registered under, that the icon is still 512×512, and steps 1 and 2 above.
   `grammar.test.ts` asserts what the grammars MATCH; nothing else asserts that the manifest can
   still find them. A renamed grammar file packages without a word and fails in a real editor as
   "the colours just don't work".

4. **Upload it.** <https://marketplace.visualstudio.com/manage/publishers/ramonda> → the `…` beside
   `ramonda.css` → **Update** → drop the file in. New installs have it within a few minutes;
   installed copies update on their own.

   No token, no Azure DevOps, nothing to sign in to beyond the publisher account.

**The version is spent either way.** The marketplace takes a version once, refuses it ever after,
and has no unpublish. That is the whole reason step 3 refuses instead of warning.

## The npm link does not gate the upload — I got this wrong once

`README.md` links `@ramonda/css` on npm, and `npm view @ramonda/css` is a 404 until `changeset
publish` runs. I read that as a reason to hold the upload back. It is not one, and the user said so.

**The marketplace renders the README of whatever version is live.** The link is not wrong TEXT — it
points at something that does not exist yet, and it starts working on its own the moment the package
publishes, with nothing re-uploaded. A fact that is about to become true is not the same as a fact
that stopped being true.

What that one really was: `0.1.0` went live saying *"Installing it — Not published yet"*, in the
install section of a published extension's own page. That was wrong text, and it stayed live for a
week because `0.1.1` was packaged and never uploaded. Which is the actual lesson — **a `.vsix` that
is built and not uploaded fixes nothing.** Check the live version before assuming the last fix
shipped: <https://marketplace.visualstudio.com/items?itemName=ramonda.css>, under *More Info*.

## Before a release that changes behaviour

Two things no test can do, because they are about the MANIFEST rather than the code:

- Install the `.vsix` into a clean editor — `code --install-extension packages/css/vscode/ramonda-css-<version>.vsix`
  — and open a file with a block. A wrong `injectTo` is invisible to every test and fatal in use.
- Read `README.md` as the marketplace renders it. It is the extension's whole front page.

## Publishing from CI, and why it is not on yet

`.github/workflows/extension.yml` is written and **disabled** — `workflow_dispatch` only, so it
cannot fire by accident. It needs one secret, `VSCE_PAT`, and that is where the chain stops:

> a PAT comes from **Azure DevOps**, which needs an **organisation**, which needs an **Azure
> subscription** with Owner or Contributor on it.

Measured on 2026-09-11, signed in as the publisher account: `dev.azure.com/_usersSettings/tokens`
is a 404 without an organisation, and the create-organisation form answers *"We couldn't find any
subscriptions you have access to."* Microsoft's own billing FAQ says the same thing — a subscription
is the requirement, pay-as-you-go included, and Azure DevOps itself stays free at its free tier.

So a pay-as-you-go Azure subscription is the price of automating step 4, and the four steps above are
the price of not having one. **Neither is urgent.** If the subscription is ever created and the
picker still comes up empty, that is a stale token: Azure portal → Settings → All Directories →
Switch to the subscription's directory, sign in again, then back to the signup.

## The account facts, so they are not rediscovered

- **Publisher `ramonda`**, created 2026-09-08, owned by the outlook.com account. The extension's full
  identifier is therefore `ramonda.css`, mirroring the npm package it serves; a second extension
  would be `ramonda.check`, on the same axis. **Neither half can be changed after the first
  publish** — a rename is a new extension, with none of the installs or ratings of the old one.

- **`icon.png` is the project's own mark**, rendered from the SVG the documentation site serves,
  which is generated from `@ramonda/theme`:

      qlmanage -t -s 1024 -o <tmp> apps/docs/public/apple-icon.svg
      sips -z 512 512 <tmp>/apple-icon.svg.png --out packages/css/vscode/icon.png

  512×512, and from the VECTOR. 128×128 is the marketplace minimum, not the size it displays: the
  item page draws the icon far larger than a list row does, and the first version of this file was a
  180×180 PNG scaled down — soft beside extensions shipping vectors. The light plate is deliberate;
  a transparent mark sits on white in one place and on near-black in another.

  **If a second extension is ever published, the axis that tells them apart is the colour of the
  flower's CENTRE** — not a letter and not a badge. The icon is drawn at 16px in the list of
  installed extensions, where three letters are a smudge and a colour is not. CSS keeps the canonical
  gold centre because it was first; the next one changes it.

- **Open VSX is a separate registry** and nothing here reaches it. Cursor, Windsurf and VSCodium
  cannot install from the Microsoft marketplace at all. It needs its own account (GitHub sign-in plus
  the Eclipse publisher agreement) and its own token: `ovsx create-namespace ramonda` once, then
  `ovsx publish ramonda-css-<version>.vsix`.

## Why the scripts live where they do

`packages/css/vscode` is deliberately **not** a workspace package — it is installed by linking and
nothing in it goes to npm — so `pnpm --filter` matches no project and says so. `pnpm
extension:package` from the root is the route; `pnpm run package` inside the folder runs the same
script. And `pnpm publish` is a built-in command, which is why the other one is called
`publish-marketplace`.

`vsce` is fetched by `pnpm dlx`, pinned to its major, rather than installed: it is a tool used twice
a year, and every contributor would otherwise carry it in every install.
