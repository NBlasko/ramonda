---
"@ramonda/core": minor
"@ramonda/server": minor
"create-ramonda": patch
---

`Head` sets `<html lang>` and `<html dir>`: `this.use(Head, (self: App) => ({ lang: self.locale }))`. The deeper `Head` wins, a page that goes away hands back what `<html>` had unless something else changed it since, and the server writes it too — `renderPage` and `renderStatic` return `lang` and `dir`, `fillDocument` writes them over the shell's `<html>`, and `renderDocument` prefers them to its `lang` option. A bilingual app had no declarative way to say its language, and the imperative write the docs offered was refused by the checker.

A server that fills its shell by hand passes `lang` and `dir` on, as it passes `title`; the scaffolded `server.mjs`, `prerender.mjs` and `entry-server.tsx` do. Left out, the server sends the shell's language and the client corrects it after hydration.
