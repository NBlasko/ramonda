/**
 * What the extension contributes to `tsserver` — the PROJECT's plugin if it has one, this copy if
 * not.
 *
 * ## Why a shim and not the plugin itself
 *
 * Contributing the plugin puts the extension's directory FIRST in `tsserver`'s candidate paths, and
 * a plugin named in a project's `tsconfig.json` is resolved from that same list. Measured in a real
 * `tsserver` log, the same project before and after the contribution:
 *
 *     without   Loading @ramonda/css/plugin from …/node_modules/typescript/lib/typescript.js/../../..
 *     with      Loading @ramonda/css/plugin from …/tools/vscode-css
 *
 * So shipping the plugin directly would silently take over checking for every project, replacing
 * whatever `@ramonda/css` it installed and pinned with whatever the extension was published from.
 * An editor disagreeing with the build about what is an error is the one thing this package cannot
 * afford.
 *
 * ## What it does instead
 *
 * Resolve `@ramonda/css/plugin` from the project's own directory and hand over to it. Only when
 * there is none — which is every project the SYNTAX server opens, because that server never reads a
 * `tsconfig.json` and so has no plugin of its own — does the bundled copy run.
 *
 * The bundled copy is therefore doing the work that made this worth building: formatting, folding,
 * the outline and expand-selection, which the syntax server answers forever rather than only while
 * a project loads. Nothing it does there depends on the project's version of the rules.
 */

const { createRequire } = require("node:module");
const { join } = require("node:path");

/** This copy, staged beside the shim by `build-plugin.mjs`. */
const bundled = require("./node_modules/@ramonda/css/dist/plugin.cjs");

/**
 * The project's own plugin, or nothing.
 *
 * `createRequire` against a file path inside the project, so resolution starts where the project is
 * rather than where this extension lives. A project with no `@ramonda/css` throws, which is the
 * ordinary case for every unrelated project an editor opens, and is not worth a log line.
 */
function projectsOwn(directory) {
  try {
    const from = createRequire(join(directory, "package.json"));
    const resolved = from.resolve("@ramonda/css/plugin");
    // Never this file's own copy: an extension installed inside a workspace could resolve back here.
    if (resolved.includes(join("vscode-css", "node_modules"))) return undefined;
    const found = from("@ramonda/css/plugin");
    const factory = found && found.__esModule ? found.default : found;
    return typeof factory === "function" ? factory : undefined;
  } catch {
    return undefined;
  }
}

module.exports = function init(modules) {
  const mine = bundled(modules);

  return {
    create(info) {
      const own = projectsOwn(info.project.getCurrentDirectory());
      if (own === undefined) return mine.create(info);

      info.project.projectService.logger.info(
        "[ramonda-css] the project has its own @ramonda/css/plugin; the extension's copy stands aside",
      );
      return own(modules).create(info);
    },
    // `tsserver` asks the MODULE for these, so a shim that hid them would shrink the plugin.
    getExternalFiles: mine.getExternalFiles === undefined ? undefined : (...args) => mine.getExternalFiles(...args),
    onConfigurationChanged:
      mine.onConfigurationChanged === undefined ? undefined : (...args) => mine.onConfigurationChanged(...args),
  };
};
