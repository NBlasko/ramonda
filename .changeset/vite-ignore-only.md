---
"@ramonda/check": patch
---

`unsplittable-import` names the bundler's own marker, `import(/* @vite-ignore */ name)`, as the one way
to say a path the bundler cannot read is deliberate. It offered `ramonda-check-ignore` as well: a second
way to say it, and an ignore is for a fault being fixed.
