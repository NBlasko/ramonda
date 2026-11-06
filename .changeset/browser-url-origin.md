---
"@ramonda/check": patch
---

`browser-url` reports only what the router answers — `pathname`, `search` and `hash`. `location.origin`, `host`, `protocol` and `href` are the browser's to tell, and reading them stopped a build that needed the origin for a share link, with no way out but an ignore comment.
