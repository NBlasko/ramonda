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
 *
 * ## Nothing here may throw, and that is not a style rule
 *
 * `tsserver` wraps a plugin's `create`, logs `Plugin activation failed` at INFO level and keeps the
 * un-proxied language service. So a throw in here shows no error anywhere: it turns a style block
 * into a syntax error in the editor with nothing said, which is the exact failure this extension
 * exists to remove. Every step below falls back instead of raising, and the last fallback is the
 * language service `tsserver` already had.
 *
 * ## One instance per project
 *
 * `enableProxy` calls the factory per project, so what is remembered below belongs to one project
 * and needs no keying by it.
 */

const { createRequire } = require("node:module");
const { join } = require("node:path");

/** This copy, staged beside the shim by `build-plugin.mjs`. */
const BUNDLED = require.resolve("./node_modules/@ramonda/css/dist/plugin.cjs");
const bundled = require(BUNDLED);

/**
 * The key that tells the bundled plugin it is answering for a project that cannot build a block.
 *
 * Read off the plugin itself rather than written out twice — the two live in different packages,
 * and a string copied into both is a string that can drift. The fallback is only reached if an
 * older copy is ever staged, and it costs one diagnostic, not the plugin.
 */
const NO_COMPILER = bundled.NO_COMPILER ?? "@ramonda/css:no-compiler-in-the-project";

/**
 * The project's own plugin, or nothing.
 *
 * `createRequire` against a path inside the project, so resolution starts where the project is
 * rather than where this extension lives. A project with no `@ramonda/css` throws, which is the
 * ordinary case for every unrelated project an editor opens and is not worth a log line.
 */
function projectsOwn(directory) {
  try {
    const from = createRequire(join(directory, "package.json"));
    /**
     * Never this copy, compared by RESOLVED PATH rather than by a name inside it.
     *
     * The first version looked for `vscode-css/node_modules`, which is this repository's working
     * tree. An installed extension lives in `ramonda.css-<version>` — measured in
     * `~/.vscode/extensions` — so that test was dead everywhere it would have mattered.
     */
    if (from.resolve("@ramonda/css/plugin") === BUNDLED) return undefined;

    const found = from("@ramonda/css/plugin");
    const factory = found && found.__esModule ? found.default : found;
    return typeof factory === "function" ? factory : undefined;
  } catch {
    return undefined;
  }
}

module.exports = function init(modules) {
  const mine = bundled(modules);
  /** Whichever module served this project — this copy, until `create` says otherwise. */
  let serving = mine;

  /** A log line may not be the thing that kills the plugin. */
  const say = (info, message) => {
    try {
      info.project.projectService.logger.info(`[ramonda-css] ${message}`);
    } catch {
      // An editor that hosts `tsserver` its own way may have no logger here, and that is fine.
    }
  };

  return {
    create(info) {
      let own;
      try {
        own = projectsOwn(info.project.getCurrentDirectory());
      } catch {
        own = undefined;
      }

      if (own !== undefined) {
        try {
          const theirs = own(modules);
          const service = theirs.create(info);
          serving = theirs;
          say(info, "the project has its own @ramonda/css/plugin; the extension's copy stands aside");
          return service;
        } catch (error) {
          // Theirs is the copy that should have run, so the line has to say which one answered.
          say(info, `the project's own @ramonda/css/plugin would not start (${error}); using the extension's copy`);
        }
      }

      try {
        /**
         * The copy in here is answering, so the project has no `@ramonda/css` and cannot build a
         * block at all — measured, esbuild refuses the file with *Expected identifier but found
         * "@"*. The plugin turns this into one diagnostic per file, beside the CSS reports rather
         * than instead of them, which is the shape TypeScript uses for JSX with no `jsx` option.
         *
         * `info` is a plain object literal in `tsserver`'s `enableProxy`, so a spread carries
         * everything and mutates nothing that belongs to the project.
         */
        return mine.create({ ...info, config: { ...info.config, [NO_COMPILER]: true } });
      } catch (error) {
        // The last fallback is what `tsserver` had before any of this. Blocks go unchecked in the
        // editor, which is what would have happened anyway — and now something says so.
        say(info, `the style-block plugin would not start (${error}); blocks are not checked here`);
        return info.languageService;
      }
    },

    /**
     * Asked of the MODULE, with the project as an argument, so it has to reach the module that
     * actually served that project. Forwarding this copy's would answer for the wrong one the
     * moment a project's own plugin grows the hook.
     */
    getExternalFiles(project, updateLevel) {
      return typeof serving.getExternalFiles === "function"
        ? serving.getExternalFiles(project, updateLevel)
        : undefined;
    },

    onConfigurationChanged(configuration) {
      if (typeof serving.onConfigurationChanged === "function") serving.onConfigurationChanged(configuration);
    },
  };
};
