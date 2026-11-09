---
"@ramonda/testing-library": minor
---

`render(<App />, { url: "/tournament?id=t1" })` mounts the tree at that address, so a routed app is tested on the page a test names, and `cleanup` puts back the address it replaced — so a test that starts at a url and navigates no longer leaves the next one on its page.
