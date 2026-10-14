import { parseArgs } from "node:util";

export type Mode = "spa" | "ssr";
export type AddOn = "css" | "router" | "query" | "form" | "lens" | "testing" | "devtools" | "biome";

export const MODES: readonly Mode[] = ["spa", "ssr"];
export const ADD_ONS: readonly AddOn[] = ["css", "router", "query", "form", "lens", "testing", "devtools", "biome"];

/**
 * Each add-on, described once. `--help`, the multi-select and the generated README all read this, so
 * they cannot say different things about the same choice.
 *
 * - `label` is the multi-select's.
 * - `adds` and `hint` make the line `--help` prints and the multi-select shows: what is installed,
 *   and what it is for.
 * - `start` is the README's: where a newcomer begins with it in this project, if anywhere.
 * - `page` is its first page on ramonda.dev.
 */
export const ADD_ON_INFO: Readonly<
  Record<AddOn, { label: string; adds: string; hint: string; start?: string; page: string }>
> = {
  css: {
    label: "CSS",
    adds: "@ramonda/css",
    hint: "style blocks, tokens, and a strict config to start from",
    start: "The page in `src/App.tsx` is written in them.",
    page: "style-blocks",
  },
  router: { label: "Router", adds: "@ramonda/router", hint: "routes and links", page: "routing" },
  query: { label: "Query", adds: "@ramonda/query", hint: "cached, race-free async data", page: "query" },
  form: { label: "Form", adds: "@ramonda/form", hint: "typed fields and schema validation", page: "forms" },
  lens: { label: "Lens", adds: "@ramonda/lens", hint: "immutable updates to nested state", page: "lens" },
  testing: {
    label: "Testing",
    adds: "vitest + @ramonda/testing-library",
    hint: "render and query components in tests",
    start: "`src/App.test.tsx` is the first test; `npm test` runs it.",
    page: "testing",
  },
  devtools: {
    label: "Devtools",
    adds: "@ramonda/devtools",
    hint: "the dev inspector, with a tab per package you picked",
    start: "Press Alt+D in development.",
    page: "devtools",
  },
  biome: {
    label: "Biome",
    adds: "@biomejs/biome",
    hint: "lint and format in one tool",
    start: "`npm run lint` and `npm run format`.",
    page: "reference/create-ramonda",
  },
};

const describe = (addon: AddOn) => `${ADD_ON_INFO[addon].adds} — ${ADD_ON_INFO[addon].hint}`;

/**
 * The multi-select's options. With `ssr` there is no Router to tick: it is always added, and a box
 * left unticked there changed nothing.
 */
export function addOnOptions(mode: Mode): { value: AddOn; label: string; hint: string }[] {
  return ADD_ONS.filter((addon) => !(mode === "ssr" && addon === "router")).map((addon) => ({
    value: addon,
    label: ADD_ON_INFO[addon].label,
    hint: describe(addon),
  }));
}

/** The README's line for a chosen add-on. */
export function readmeLine(addon: AddOn): string {
  const { start, page } = ADD_ON_INFO[addon];
  return `- ${describe(addon)}.${start === undefined ? "" : ` ${start}`} Start at https://ramonda.dev/${page}`;
}

/**
 * What the CLI says, word for word — read by the prompts and by the docs' GIF of them, which is drawn
 * from these rather than recorded, so a question reworded here is a stale picture the docs gate stops.
 */
export const SAY = {
  intro: "🌸 create-ramonda",
  target: "Where should the app go?",
  mode: "How should it render?",
  addons: "Add packages and tooling?",
  addonsKeys: "(space to toggle, enter to confirm)",
  git: "Initialise a git repository?",
  install: (pm: string) => `Install dependencies with ${pm}?`,
  scaffolded: (where: string) => `Scaffolded ${where}`,
  initialised: "Initialised a git repository",
  replaced: (files: readonly string[]) =>
    `Replaced ${files.length} file(s) the folder already had: ${files.join(", ")}`,
  keptReadme: "Kept your README.md; the project's own is README.ramonda.md.",
  keptIgnore: "Kept your .gitignore, and added the lines it lacked.",
  installed: "Installed dependencies",
  nextSteps: "Next steps",
  beforeCommit: "Before a commit — lint, tests and build, whichever the project has:",
  explained: "Every script and file is explained at https://ramonda.dev/reference/create-ramonda",
  outro: "Ramonda is ready. Docs: https://ramonda.dev",
} as const;

export const MODE_OPTIONS: readonly { value: Mode; label: string; hint: string }[] = [
  { value: "spa", label: "SPA", hint: "client-side, Vite — the simplest start" },
  { value: "ssr", label: "SSR", hint: "server-rendered + hydrated, Node server — includes the router" },
];

/** The commands the last note lists — `""` is the blank line before the commit one. */
export function nextSteps(cd: string, installed: boolean, pm: string): string[] {
  const run = pm === "npm" ? "npm run" : pm;
  return [
    ...(cd ? [`$ cd ${cd}`] : []),
    ...(installed ? [] : [`$ ${pm} install`]),
    `$ ${run} dev`,
    "",
    SAY.beforeCommit,
    `$ ${run} check`,
  ];
}

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
${ADD_ONS.map((addon) => `                          ${addon.padEnd(9)} ${describe(addon)}`).join("\n")}
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
 * Every option the command line takes. `FLAGS` — what a slip is matched against — is made from this,
 * and a test holds `--help` to naming each, so the three cannot list different flags.
 */
const OPTIONS = {
  mode: { type: "string" },
  add: { type: "string" },
  git: { type: "boolean" },
  install: { type: "boolean" },
  overwrite: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/** The two questions that are yes or no; only these have a `--no-` form. */
const NEGATABLE = ["git", "install"] as const;

export const FLAGS: readonly string[] = [
  ...Object.keys(OPTIONS).map((name) => `--${name}`),
  ...NEGATABLE.map((name) => `--no-${name}`),
];

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
      options: OPTIONS,
    }));
  } catch (error) {
    // Node's own message names the flag: `Unknown option '--sssr'`.
    // Only its first sentence: the rest is advice about positionals starting with `-`, which is
    // not what anyone who mistyped a flag needs.
    const message = (error as Error).message.split(". ")[0].replace(/\.$/, "");
    const given = /'(--[^']+)'/.exec(message)?.[1];
    const meant = given === undefined ? undefined : nearest(given, FLAGS);
    return {
      kind: "error",
      message: `${message}.${meant === undefined ? "" : ` Did you mean ${meant}?`} See --help for the options.`,
    };
  }

  // `allowNegative` gives every boolean a `--no-` form, and `--no-help` or `--no-yes` would be read
  // as false and do nothing. Only the two yes-or-no questions have one.
  const negated = Object.entries(values).find(
    ([name, value]) => value === false && !(NEGATABLE as readonly string[]).includes(name),
  );
  if (negated !== undefined) {
    return { kind: "error", message: `Unknown option '--no-${negated[0]}'. See --help for the options.` };
  }

  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };
  if (positionals.length > 1) {
    return { kind: "error", message: `One folder, not ${positionals.length}: ${positionals.join(" ")}.` };
  }

  const mode = values.mode?.toLowerCase();
  if (mode !== undefined && !MODES.includes(mode as Mode)) {
    const meant = nearest(mode, MODES);
    return {
      kind: "error",
      message: `--mode is spa or ssr, not "${mode}".${meant === undefined ? "" : ` Did you mean "${meant}"?`}`,
    };
  }

  let addons: AddOn[] | undefined;
  if (values.add !== undefined) {
    const names = values.add
      .split(",")
      .map((one) => one.trim().toLowerCase())
      .filter(Boolean);
    // An empty list is most often an empty variable in a script, not a choice of nothing.
    if (names.length === 0) {
      return { kind: "error", message: `--add needs a list — ${ADD_ONS.join(", ")} — or none for nothing.` };
    }
    if (names.includes("none") && names.length > 1) {
      return {
        kind: "error",
        message: `--add none means nothing else; it cannot be listed beside ${names.filter((one) => one !== "none").join(", ")}.`,
      };
    }
    const unknown = names.filter((one) => one !== "none" && !ADD_ONS.includes(one as AddOn));
    if (unknown.length > 0) {
      return {
        kind: "error",
        message:
          `--add does not know ${unknown.map((one) => `"${one}"`).join(", ")}.` +
          unknown
            .map((one) => nearest(one, ADD_ONS))
            .filter((meant) => meant !== undefined)
            .map((meant) => ` Did you mean "${meant}"?`)
            .join("") +
          ` It takes: ${ADD_ONS.join(", ")}, or none.`,
      };
    }
    addons = [...new Set(names.filter((one): one is AddOn => one !== "none"))];
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

/**
 * The closest of `among` to `word`, if one is close enough to be a slip: at most two edits, and
 * fewer than half the word — so `quey` finds `query`, and `kubernetes` finds nothing.
 */
export function nearest(word: string, among: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Math.min(2, Math.floor(word.length / 2));
  for (const candidate of among) {
    if (word === candidate) continue;
    // Case alone is a slip too: `--Mode` is `--mode`.
    const distance = editDistance(word.toLowerCase(), candidate);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Levenshtein distance — insertions, deletions and substitutions, one row at a time. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[b.length];
}
