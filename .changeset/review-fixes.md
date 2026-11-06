---
"@ramonda/form": patch
"@ramonda/server": patch
"create-ramonda": patch
---

What a review of this release's changes found. A field's issue keeps its `message` when the validator's issues are class instances with `message` on the prototype. A field reading `issues` re-renders when an issue changes while its message does not — a `code` moving from `s:minLength` to `s:pattern`, which is what a translation reads. `fillDocument` reads the shell's `<html>` attributes instead of searching their text, so `class="x lang=fr"` is left alone and a valueless `<html lang>` is replaced rather than given a second `lang`. The SSR template empties `dist/client` before each build, so a file deleted from `public/` is not served from the last one, and it lists the files under `dist/client` once at startup, instead of asking the disk whether one exists on every request — each file is still read when it is served — and the build copies `public/` with every link resolved — a linked file or folder lands as what it points at, and a link that loops or points nowhere stops the build naming it — so the server serves only real files and follows no link; a file it listed and that has gone since, as a rebuild in place leaves it, is a 404 rather than a crash, which would have served whatever one pointed at, `.env` included.
