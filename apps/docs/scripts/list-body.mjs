/**
 * A surface test's list, from `start` to its own closing `];`, with every comment taken out.
 *
 * Read a character at a time, because each shortcut dropped names with the build green: cut at the
 * first `];`, one inside a comment (`kinds[0];`) ended the list early; with comments stripped by a
 * pattern first, a `/*` inside a `//` comment swallowed the rest of the list, and a `//` inside a
 * string cut a name. So strings and both kinds of comment are skipped for what they are, and only a
 * `];` outside all three ends the list. One that never ends is an error, not the rest of the file.
 *
 * @param {string} surface
 * @param {number} start
 */
export function listBody(surface, start) {
  let body = "";
  let at = start;
  while (at < surface.length) {
    const two = surface.slice(at, at + 2);
    if (two === "//") {
      const end = surface.indexOf("\n", at);
      at = end === -1 ? surface.length : end;
      continue;
    }
    if (two === "/*") {
      const end = surface.indexOf("*/", at + 2);
      at = end === -1 ? surface.length : end + 2;
      continue;
    }
    if (two === "];") return body;
    const char = surface[at];
    if (char === '"' || char === "'" || char === "`") {
      let end = at + 1;
      while (end < surface.length && surface[end] !== char) end += surface[end] === "\\" ? 2 : 1;
      body += surface.slice(at, end + 1);
      at = end + 1;
      continue;
    }
    body += char;
    at++;
  }
  throw new Error(`[docs] The list at offset ${start} never ends — no \`];\` closes it.`);
}
