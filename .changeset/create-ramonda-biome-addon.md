---
"create-ramonda": patch
---

Add an optional **Biome** choice to the scaffolder — one tool for both linting and
formatting.

Picking it drops a `biome.json` (recommended lint rules via Biome 2.x's `preset`,
2-space / 120-column formatter, git-ignore aware) into the project, adds
`@biomejs/biome` as a dev dependency, and wires up `lint` (`biome lint .`) and
`format` (`biome format --write .`) scripts. Both templates ship already formatted the
way the config expects, so a fresh project is clean on the first run — `format` reports
no changes and `lint` passes.
