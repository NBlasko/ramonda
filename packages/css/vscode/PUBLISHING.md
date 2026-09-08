# Publishing this extension

Everything in this folder is ready to package. What is left needs an account, and an account is not
something a repository can hold — so this is the list, in the order it has to happen.

## Once, by a person

1. **A publisher on the Visual Studio Marketplace.** DONE — `ramonda`, created 2026-09-08. The full
   identifier of this extension is therefore `ramonda.css`, which mirrors the npm package it serves
   (`@ramonda/css`); a second extension would be `ramonda.check`, on the same axis. **Neither half of
   that identifier can be changed after the first publish** — a rename is a new extension, with none
   of the installs or ratings of the old one.
   <https://marketplace.visualstudio.com/manage>

2. **A Personal Access Token** from Azure DevOps, in the same organisation as the publisher, scoped
   to **Marketplace → Manage** and nothing else. This is the token CI uses.

3. **A repository secret** — `VSCE_PAT` — holding it. The workflow below reads that name.

4. **`icon`** — DONE, and where it comes from matters more than the file. `icon.png` is the project's
   own mark, rendered from the SVG the documentation site serves, which is itself generated from
   `@ramonda/theme`:

       qlmanage -t -s 1024 -o <tmp> apps/docs/public/apple-icon.svg
       sips -z 512 512 <tmp>/apple-icon.svg.png --out packages/css/vscode/icon.png

   **512×512, and from the SVG rather than from a PNG.** 128×128 is the marketplace MINIMUM, not the
   size it displays: the item page draws the icon far larger than a list row does, and the first
   version of this file was a 180×180 PNG scaled down to 128 — which looked soft beside extensions
   shipping vectors. The user noticed before anybody else could. Render from the vector at a
   multiple, then scale down once; never scale a small raster up.

   The light plate is deliberate: a transparent mark sits on white in one place and on near-black in
   another.

   **If a second extension is ever published — a checker, say — the axis that tells them apart is the
   colour of the flower's CENTRE**, not a letter and not a badge. The icon is drawn at 16px in the
   list of installed extensions, where three letters are a smudge and a colour is not. CSS keeps the
   canonical gold centre because it is the first one; the next one changes it.

5. **Open VSX, if the extension should reach Cursor, Windsurf or VSCodium** — none of them can
   install from the Microsoft marketplace. A separate registry, a separate account (GitHub sign-in
   plus the Eclipse publisher agreement) and a separate token: `ovsx create-namespace ramonda` once,
   then `ovsx publish ramonda-css.vsix`. Nothing in this folder depends on it.

## Every release

Both are run **from this folder**, and neither is a `pnpm --filter` away. `packages/css/vscode` is
deliberately not a workspace package — it is installed by linking and nothing in it goes to npm — so
a filter matched no project and said so; and `pnpm publish` is a BUILT-IN command, which is why the
second script is not called `publish`.

    cd packages/css/vscode
    pnpm run package               # writes ramonda-css.vsix
    pnpm run publish-marketplace   # needs VSCE_PAT in the environment

`vsce` is fetched by `pnpm dlx`, pinned to its major, rather than installed: it is a tool used twice
a year, and every contributor would otherwise carry it in every install.

**`version` is `0.0.0` and has to move before the first publish.** The marketplace refuses a version
it has already seen, and unlike npm there is no unpublish. It is the manifest's version that moves
and nothing else: `install.mjs` reads the name and version out of the manifest, so the linked folder
follows a bump on its own.

## What is deliberately NOT automated

The extension is **not** part of `changeset publish`. Its version and the npm packages' versions
answer different questions — an extension is released when its grammars or diagnostics change, and
`@ramonda/css` is released when its API does — and tying them together would publish an unchanged
extension on every patch of anything.

## A workflow, when the token exists

`.github/workflows/extension.yml` is written and **disabled**: its trigger is `workflow_dispatch`
only, so it cannot fire by accident before step 3 above is done. Add the secret, then decide whether
to give it a tag trigger.

## Before the first publish, check by hand

- Install the `.vsix` into a clean editor (`code --install-extension ramonda-css.vsix`) and open a
  file with a block. The grammars are asserted by `grammar.test.ts`, but the MANIFEST that loads them
  is not — a wrong `injectTo` or a renamed grammar file is invisible to those tests.
- Read `README.md` as the marketplace will render it: it is the extension's whole front page.
