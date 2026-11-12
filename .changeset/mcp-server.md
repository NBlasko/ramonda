---
"@ramonda/mcp": minor
"@ramonda/check": minor
---

`@ramonda/mcp`, an MCP server for a Ramonda app. A coding agent checks each file it is about to write with `check_code` — the app's own checker, reading the file as if it were saved, with the rest of the project — and reads the docs of the installed version with `docs` and `explain`. `check_project` gives the verdict the build will reach. Every tool only reads.

`@ramonda/check` exports what the server is built on, for any program to use: `analyzeProject(tsconfig, { files })` checks code that is not saved yet, `reportOf(result)` is the object `--json` prints, and `docsPage(page)` and `explainPage(code)` are the pages `docs` and `explain` print.

`@ramonda/mcp` runs the checker the app already has — a peer dependency, so the agent and the build reach the same verdict. It needs `@ramonda/check` from this release or later: update the two together.
