---
title: The MCP server
description: ramonda-mcp lets a coding agent check each file with your app's own checker before it is saved, and read the docs of the version you have installed.
section: Reference
order: 117
---

# The MCP server

`@ramonda/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server for a Ramonda
app. A coding agent that speaks MCP gets four tools from it:

| tool | what it answers |
|---|---|
| `check_code` | What is wrong in one file, **before it is saved** — read with the rest of the project, by what your build runs: `ramonda-check` and the type check. |
| `check_project` | What is wrong in the whole app, by the same two. |
| `docs` | A page of these docs, for the version you have installed. |
| `explain` | What a diagnostic code (`RMD020`) or a checker rule (`unknown-hook-option`) means. |

Every tool only reads. Nothing is written to disk, and nothing of your app is run.

## Install

```install
-D @ramonda/mcp
```

A project made by `create-ramonda` with the `mcp` add-on has all of this already. Otherwise, tell
your agent how to start it. Most clients read a `.mcp.json` in the project's folder:

```json
{
  "mcpServers": {
    "ramonda": { "command": "npx", "args": ["ramonda-mcp"] }
  }
}
```

The server works in the folder it is started in, and reads `tsconfig.json` there. In a monorepo,
start it in the app's folder, or pass the tool a `tsconfig` of its own.

## Check before writing

`check_code` takes a path and the whole file as it would be saved. It lays that text over the disk
and runs what your build runs before it bundles anything — [`ramonda-check`](/reference/check), then
the type check — and answers with what they found in that file:

```json
{
  "tool": "ramonda-mcp",
  "ok": false,
  "findings": [
    {
      "code": "markup-helper-in-render",
      "severity": "error",
      "file": "/app/src/Standings.tsx",
      "line": 5,
      "column": 11,
      "message": "<Standings> builds `head` inside render() and calls it there — …"
    }
  ],
  "notes": []
}
```

Each finding is named the way its own command's `--json` names it: a rule of `ramonda-check`
(`markup-helper-in-render`), a TypeScript error (`TS2322`), or a rule of `ramonda-css`. The checker's
are built by the same code as `ramonda-check --json`, so the agent is told what your build will say.

The type check is the one your `typecheck` script runs. In an app with
[style blocks](/style-blocks) that is `ramonda-css`, which reads the blocks the compiler cannot, and
the server asks **your installed copy** of it — so the answer is your build's, version for version.
Every other app gets `tsc --noEmit`. When the app names `@ramonda/css` and none is installed, the
answer is `type-check-not-run` and not a pass: a check that did not run must not read as one that
did.

Tell the agent to use it. One line in its instructions — an `AGENTS.md`, a `CLAUDE.md` — is enough:

```md
Before showing any code for this Ramonda app, run the `check_code` tool on every file you wrote or
changed, and fix what it reports.
```

## The docs it reads

`docs` and `explain` answer from the pages packed into `@ramonda/check` when it was released — the
same text `ramonda-check docs` and `ramonda-check explain` print. So the agent reads the page for the
code your installed version prints, not the latest release's. A slip in a page's name is answered
with what was meant.

## What it does not do

It writes no code. It has no template for a component or a route, because a template drifts from
the docs it was copied from; the agent writes the code, and the server says what is wrong with it.

It does not read a running app yet. The diagnostics a page raises in the browser are still read
from the browser's console, or from a test — see [Diagnostics](/reference/diagnostics).

## Next

- [Checking your app](/reference/check) — the checker `check_code` runs, and every rule it has.
- [Diagnostics](/reference/diagnostics) — every code `explain` answers.
