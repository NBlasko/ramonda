---
"create-ramonda": minor
---

Writing into a folder that already has files keeps what is yours: an existing `.gitignore` is kept and gains only the lines the project needs, an existing `README.md` stays and the project's is written beside it as `README.ramonda.md`, and every other file the template replaced is named. A `.gitignore` used to be replaced without a word.

An SSR project's dev server shares its port with hot reload, so two apps side by side each reload; a port already in use is a sentence naming `PORT=…`, not a stack trace; and its README says how to pick the port.
