# @ramonda/mcp

An MCP server for a Ramonda app. An agent checks each file it is about to write with the app's own
checker, before the file is saved, and reads the docs of the version the app has installed.

[readme:start]: #

[![npm](https://img.shields.io/npm/v/%40ramonda%2Fmcp)](https://www.npmjs.com/package/@ramonda/mcp)
[![license](https://img.shields.io/npm/l/%40ramonda%2Fmcp)](https://github.com/NBlasko/ramonda/blob/main/LICENSE)

> **Status: `0.x`.** The API changes freely between releases while the design is
> being explored; from `1.0` the interfaces hold. A breaking change ships as a
> **minor** until then — see [Upgrading](https://ramonda.dev/reference/upgrading)
> for what that means for a version range, and the
> [root README](https://github.com/NBlasko/ramonda#readme).

```sh
npm install -D @ramonda/mcp
```

Documentation: **[ramonda.dev/reference/mcp](https://ramonda.dev/reference/mcp)**

[readme:end]: #

```json
{
  "mcpServers": {
    "ramonda": { "command": "npx", "args": ["ramonda-mcp"] }
  }
}
```

Four tools, all of them read-only: `check_code`, `check_project`, `docs` and `explain`.

## License

[MIT](./LICENSE) © Nikola Blagojević
