const { execFileSync } = require("node:child_process");
const { dirname } = require("node:path");
const vscode = require("vscode");
const { commandFor } = require("./locate");

/**
 * Format-on-save for a file holding a `@( … )` style block, which no formatter can do on its own.
 *
 * ## The fault this exists for
 *
 * Measured: the Biome extension does nothing at all with such a file, because a file holding a block
 * is excluded from `biome.json` — and with the exclusion lifted, biome answers *"Code formatting
 * aborted due to parsing errors"*. The syntax is not TypeScript, and `biome-ignore` cannot help,
 * because it is read BY the parser that already failed. Prettier refuses the same way.
 *
 * ## Why it shells out instead of formatting here
 *
 * The PROJECT's own `ramonda-css` runs, with the project's own biome and the project's own config —
 * so a file formatted on save is what `pnpm format` would have produced. An extension carrying its
 * own copy of the compiler would drift from the one the repository builds with, and the drift would
 * show up as a file two commands disagree about.
 *
 * It formats the BUFFER, through `--stdin-file-path`: an editor asks about the text on screen, and a
 * provider that pointed the command at a path would format what was last saved and hand back edits
 * computed against text the author has since changed.
 */

/** The whole document, which is the range an edit replaces. */
function everything(document) {
  return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}

function activate(context) {
  const output = vscode.window.createOutputChannel("Ramonda CSS");

  const provider = {
    provideDocumentFormattingEdits(document) {
      const file = document.uri.fsPath;
      const command = commandFor(file);

      // Not an error: a file outside a project that installed the package is not this extension's to
      // format, and complaining on every save of every file would be worse than doing nothing.
      if (command === undefined) return [];

      const text = document.getText();

      try {
        const formatted = execFileSync(command, ["format", `--stdin-file-path=${file}`], {
          cwd: dirname(file),
          input: text,
          encoding: "utf8",
        });

        return formatted === text ? [] : [vscode.TextEdit.replace(everything(document), formatted)];
      } catch (error) {
        /**
         * The tool's own words, in a channel rather than a modal. A formatter answering with a stack
         * trace would hide the one useful sentence — a config it cannot read, a block it cannot
         * parse — and a formatter that threw would make every save look broken.
         */
        output.appendLine(`${file}\n${error.stderr ?? error.message}`);
        return [];
      }
    },
  };

  for (const language of ["typescriptreact", "typescript", "javascriptreact", "javascript"]) {
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider({ language }, provider));
  }

  context.subscriptions.push(output);
}

module.exports = { activate };
