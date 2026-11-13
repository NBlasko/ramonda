import { readFileSync } from "node:fs";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server";

/**
 * `ramonda-mcp`: the server over stdio, for a client that starts it in the app's folder — which is
 * what `.mcp.json` beside the app does. stdout is the protocol's, so nothing here may print to it.
 */
const own = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
serveStdio(() => createServer({ version: own.version }));
