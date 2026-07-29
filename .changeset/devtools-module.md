---
"@ramonda/devtools": patch
---

The package is a module as far as TypeScript is concerned, and it is type-checked.

An app has to import the panel itself — core loads it through a dynamic import whose specifier
is a variable, so a bundler leaves the string alone and the browser cannot fetch it. Doing that
failed to type-check: `src/index.ts` registers `<ramonda-devtools>` and exports nothing, so
TypeScript rejected the import with "is not a module". An explicit `export {}` says what the
file is — a side-effect module.

It also had no `tsconfig.json` and no `check-types` script, so 600+ lines that ship to users
were checked by nothing. Both added; `turbo run check-types` covers 8 packages now.
