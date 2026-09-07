# Publishing this extension

Everything in this folder is ready to package. What is left needs an account, and an account is not
something a repository can hold — so this is the list, in the order it has to happen.

## Once, by a person

1. **A publisher on the Visual Studio Marketplace.** `package.json` says `"publisher": "ramonda"`;
   whatever name is created has to match it, or `vsce` refuses.
   <https://marketplace.visualstudio.com/manage>

2. **A Personal Access Token** from Azure DevOps, in the same organisation as the publisher, scoped
   to **Marketplace → Manage** and nothing else. This is the token CI uses.

3. **A repository secret** — `VSCE_PAT` — holding it. The workflow below reads that name.

4. **`icon`** — 128×128 PNG, referenced from `package.json` as `"icon": "icon.png"`. The marketplace
   page has a blank square without one. It is deliberately not committed as a placeholder: a
   placeholder icon ships as the real icon the first time somebody forgets.

## Every release

    pnpm --filter ramonda-css-vscode package     # writes ramonda-css.vsix
    pnpm --filter ramonda-css-vscode publish     # needs VSCE_PAT in the environment

**`version` is `0.0.0` and has to move before the first publish.** The marketplace refuses a version
it has already seen, and unlike npm there is no unpublish.

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
