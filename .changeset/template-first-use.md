---
"create-ramonda": minor
---

What a first real use of each add-on met, fixed in the template:

- With Biome, `check` runs `format:check` — the formatter without writing — so unformatted code fails it rather than passing.
- `--add form` installs `bguard`, which every example on the Forms pages imports.
- `vitest.config.ts` sets `globals: true`, which lets the testing library unmount each test's tree; the second test to mount the app found the first one's Router still live.
- The SSR production build compiles a style block in a `.ts` file, as development and the tests already did — its filter named only `.tsx`.
- `biome.json` counts `<Select>` and `<TextArea>` as the controls a `<label>` names.
