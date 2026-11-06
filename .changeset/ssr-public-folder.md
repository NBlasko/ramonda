---
"create-ramonda": patch
---

The SSR template serves `public/` in production. Vite serves it under the dev server, but the production build never copied it and `server.mjs` answered only `/assets/*`, so `public/robots.txt` worked under `npm run dev` and was a 404 after `npm run build && npm start`. `scripts/build.mjs` now copies the folder into `dist/client`, and the server answers any file there — never one outside it, and never the raw `index.html` shell.
