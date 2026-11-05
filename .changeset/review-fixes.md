---
"@ramonda/form": patch
"@ramonda/server": patch
"create-ramonda": patch
---

What a review of this release's changes found. A field reading `issues` re-renders when an issue changes while its message does not — a `code` moving from `s:minLength` to `s:pattern`, which is what a translation reads. `fillDocument` reads the shell's `<html>` attributes instead of searching their text, so `class="x lang=fr"` is left alone and a valueless `<html lang>` is replaced rather than given a second `lang`. The SSR template lists the files under `dist/client` once at startup, instead of asking the disk whether one exists on every request — each file is still read when it is served — and the build copies `public/` with every link resolved — a linked file or folder lands as what it points at, and a link that loops or points nowhere stops the build naming it — so the server serves only real files and follows no link, which would have served whatever one pointed at, `.env` included.
