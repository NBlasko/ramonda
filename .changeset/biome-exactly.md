---
"create-ramonda": minor
---

A new project gets Biome at exactly the version the framework is checked with

A caret handed every new project the newest Biome, and a formatter prints differently within a minor:
on the day Biome 2.6 came out, a project made with the Biome add-on failed its own first
`biome format .` on the template's README. The dependency and the `biome.json` schema now name the
one version this repository runs.
