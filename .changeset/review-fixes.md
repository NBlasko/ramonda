---
"@ramonda/form": patch
"@ramonda/server": patch
"@ramonda/core": patch
"create-ramonda": patch
---

What a review of this release's changes found. A field reading `issues` re-renders when an issue changes while its message does not — a `code` moving from `s:minLength` to `s:pattern`, which is what a translation reads. `fillDocument` reads the shell's `<html>` attributes instead of searching their text, so `class="x lang=fr"` is left alone and a valueless `<html lang>` is replaced rather than given a second `lang`. When a request ends, `Head` hands `<html lang>` and `dir` back only while they still hold what a `Head` wrote, as it does when a page goes away. The SSR template reads the files under `dist/client` once at startup, instead of asking the disk on every request.
