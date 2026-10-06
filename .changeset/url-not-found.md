---
"@ramonda/css": patch
---

**A relative `url( … )` that points at no file is refused** (`url-not-found`). `url("./img/hero.png")`
with no such file built without a word and shipped a 404 — a moved image, or a component moved away
from its image, broke nothing anyone saw. The file is now looked for beside the source file, in the
build, the editor and `ramonda-check`, and `@@font-face`'s `src` with it. A path from the site's
root (`/hero.png`), another site and `data:` are left alone.
