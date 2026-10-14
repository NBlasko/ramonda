import { parseArgs } from "node:util";

export type Mode = "spa" | "ssr";
export type AddOn = "css" | "router" | "query" | "form" | "lens" | "testing" | "devtools" | "biome";

export const MODES: readonly Mode[] = ["spa", "ssr"];
export const ADD_ONS: readonly AddOn[] = ["css", "router", "query", "form", "lens", "testing", "devtools", "biome"];

/** What the multi-select starts with, and what `--yes` takes. */
export const DEFAULT_ADD_ONS: readonly AddOn[] = ["css", "devtools"];
export const DEFAULT_TARGET = "ramonda-app";

/**
 * Every question the CLI asks, answered on the command line. A field left `undefined` is a question
 * still to ask — or, with `--yes`, to take the default of.
 */
export interface Answers {
  target?: string;
  mode?: Mode;
  addons?: AddOn[];
  git?: boolean;
  install?: boolean;
  overwrite: boolean;
  yes: boolean;
}

export type Parsed =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "answers"; answers: Answers }
  | { kind: "error"; message: string };

export const HELP = `Usage: create-ramonda [folder] [options]

Scaffolds a Ramonda app into [folder] (default: ${DEFAULT_TARGET}). Every question it asks has a
flag; a question answered by a flag is not asked. With no terminal — a script, CI, an agent —
every question must be answered by a flag or by --yes.

Options:
  --mode <spa|ssr>      How it renders. spa: client-side, Vite. ssr: server-rendered and
                        hydrated, on a Node server — always includes the router.
  --add <list>          Packages and tooling, comma-separated, or "none":
                          css       @ramonda/css — style blocks, tokens, a strict config
                          router    @ramonda/router — routes and links
                          query     @ramonda/query — cached, race-free async data
                          form      @ramonda/form — typed fields and schema validation
                          lens      @ramonda/lens — immutable state updates
                          testing   vitest + @ramonda/testing-library
                          devtools  @ramonda/devtools — the dev inspector
                          biome     @biomejs/biome — lint and format
                        Default: ${DEFAULT_ADD_ONS.join(",")}.
                        Always added: @ramonda/core, @ramonda/build, @ramonda/check; with ssr,
                        also @ramonda/server and @ramonda/router.
  --git, --no-git       Initialise a git repository. Default: yes.
  --install, --no-install
                        Install dependencies with the package manager that ran this. Default: yes.
  --overwrite           Write into a folder that is not empty. Never assumed, not even by --yes.
  -y, --yes             Take the default for every question no flag answers.
  -h, --help            Print this and exit.
  -v, --version         Print the version and exit.

Examples:
  npm create ramonda@latest my-app
  npm create ramonda@latest my-app -- --yes
  npm create ramonda@latest my-app -- --mode ssr --add css,query,testing --no-git
`;

/**
 * Reads the command line. Pure: no prompt, no exit, no file — so every refusal is testable, and
 * nothing is written before the whole line has been read.
 */
export function readArgs(argv: readonly string[]): Parsed {
  let values;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      allowNegative: true,
      strict: true,
      options: {
        mode: { type: "string" },
        add: { type: "string" },
        git: { type: "boolean" },
        install: { type: "boolean" },
        overwrite: { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    }));
  } catch (error) {
    // Node's own message names the flag: `Unknown option '--sssr'`.
    return { kind: "error", message: `${(error as Error).message}. See --help for the options.` };
  }

  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };
  if (positionals.length > 1) {
    return { kind: "error", message: `One folder, not ${positionals.length}: ${positionals.join(" ")}.` };
  }

  const mode = values.mode;
  if (mode !== undefined && !MODES.includes(mode as Mode)) {
    return { kind: "error", message: `--mode is spa or ssr, not "${mode}".` };
  }

  let addons: AddOn[] | undefined;
  if (values.add !== undefined) {
    const names = values.add
      .split(",")
      .map((one) => one.trim().toLowerCase())
      .filter(Boolean);
    const unknown = names.filter((one) => one !== "none" && !ADD_ONS.includes(one as AddOn));
    if (unknown.length > 0) {
      return {
        kind: "error",
        message: `--add does not know ${unknown.map((one) => `"${one}"`).join(", ")}. It takes: ${ADD_ONS.join(", ")}, or none.`,
      };
    }
    addons = names.filter((one): one is AddOn => one !== "none");
  }

  return {
    kind: "answers",
    answers: {
      target: positionals[0],
      mode: mode as Mode | undefined,
      addons,
      git: values.git,
      install: values.install,
      overwrite: values.overwrite ?? false,
      yes: values.yes ?? false,
    },
  };
}

/** The flags of the questions no flag answered — what a run with no terminal has to be told. */
export function unanswered(answers: Answers): string[] {
  const missing: string[] = [];
  if (answers.target === undefined) missing.push("[folder]");
  if (answers.mode === undefined) missing.push("--mode <spa|ssr>");
  if (answers.addons === undefined) missing.push("--add <list|none>");
  if (answers.git === undefined) missing.push("--git or --no-git");
  if (answers.install === undefined) missing.push("--install or --no-install");
  return missing;
}
