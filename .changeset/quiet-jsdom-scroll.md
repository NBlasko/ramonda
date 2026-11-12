---
"@ramonda/testing-library": patch
---

Under jsdom, `window.scrollTo` and `window.scrollBy` do nothing instead of printing "Not implemented". jsdom has no layout, and the router scrolls to the top on every `push`, so every test that navigated printed the line — noise that said nothing about the app. A browser-based runner keeps real scrolling.
