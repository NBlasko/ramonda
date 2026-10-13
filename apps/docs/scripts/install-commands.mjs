/**
 * A fence written as ```install becomes one tab per package manager.
 *
 * Install commands on these pages were `npm install` on some and `pnpm add` on others, in three
 * fence languages — a reader using a third manager translated every one. So a page names what to
 * install, once, and the build writes it for each:
 *
 *     ```install
 *     @ramonda/router
 *     -D @ramonda/devtools
 *     create ramonda@latest my-app
 *     ```
 *
 * Every spelling here was RUN before it was written down, each in an empty project: `add` and a dev
 * dependency in npm, pnpm, yarn 1 and bun, and `create` in npm, pnpm and bun. `yarn create` is left
 * out — yarn 1 installs the starter globally, which fails without write access to a global folder,
 * and a command that works only on some machines is not one to print.
 */
const PACKAGE = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=-]+)?$/i;

/** What starts a command rather than a package — a manager, or its verb. */
const COMMAND_WORDS = new Set(["npm", "pnpm", "yarn", "bun", "npx", "install", "add", "i"]);

export function installCommands(text, where) {
  const lines = text
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const creates = lines.some((line) => line.startsWith("create "));
  const managers = creates ? ["npm", "pnpm", "bun"] : ["npm", "pnpm", "yarn", "bun"];
  const spell = (manager, line) => {
    const words = line.split(/\s+/);
    if (words[0] === "create") return `${manager} ${line}`;
    // A command written out whole — `npm install x` — is three valid package NAMES, and would be
    // printed as `npm install npm install x`. The fence holds what to install, never how.
    if (COMMAND_WORDS.has(words[0])) {
      throw new Error(
        `[docs] ${where}: an \`install\` fence names what to install, and \`${line}\` is a command. ` +
          `Write \`${words.slice(words[0] === "npx" ? 1 : 2).join(" ")}\` — the build writes it for each manager.`,
      );
    }
    const dev = words[0] === "-D";
    const packages = dev ? words.slice(1) : words;
    const wrong = packages.find((one) => !PACKAGE.test(one));
    if (packages.length === 0 || wrong !== undefined) {
      throw new Error(
        `[docs] ${where}: an \`install\` fence line is \`[-D] <package>…\` or \`create <starter> [args]\`, ` +
          `and \`${line}\` is neither${wrong === undefined ? "" : ` — \`${wrong}\` is not a package name`}.`,
      );
    }
    const add = manager === "npm" ? "install" : "add";
    const flag = !dev ? "" : manager === "bun" ? " -d" : " -D";
    return `${manager} ${add}${flag} ${packages.join(" ")}`;
  };
  return managers.map((manager) => [manager, lines.map((line) => spell(manager, line)).join("\n")]);
}
