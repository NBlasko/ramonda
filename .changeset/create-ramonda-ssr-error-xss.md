---
"create-ramonda": patch
---

Fix a reflected-XSS hole in the SSR template's error page. `server.mjs` wrote an error's
message straight into an HTML `<pre>` on a 500, and an error can carry parts of the request
(a malformed URL or header), so a crafted request could inject markup. The error text is now
HTML-escaped before it reaches the page.
