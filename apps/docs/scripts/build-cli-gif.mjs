/**
 * Renders the GIF of `create-ramonda` asking its questions — `public/media/create-ramonda*.gif`.
 *
 *   node scripts/build-cli-gif.mjs          # render it
 *   node scripts/build-cli-gif.mjs --check  # fail if what the CLI says has moved since
 *
 * ## Drawn from the CLI's own words
 *
 * Every question, option, hint and closing line comes from what the built scaffolder exports and
 * prints from — `SAY`, `MODE_OPTIONS`, `addOnOptions`, `nextSteps` — so the words cannot drift from
 * the CLI. The LOOK is drawn here after the prompt library's own, as it renders in a terminal: the
 * `◆`/`◇` steps, a hint shown only beside the option the cursor is on, `◼`/`◻` for a choice.
 *
 * `--check` hashes the frames' text into a stamp beside the GIF, as `build-editor-gifs.mjs` does:
 * a reworded question is a failing check, not a picture that lies.
 *
 * Needs `create-ramonda` built, Chromium from the playground's Playwright, and `ffmpeg`.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const OUT = join(here, "..", "public", "media");
const STAMPS = join(here, "cli-gif.stamp.json");
const check = process.argv.includes("--check");

const cli = join(repo, "packages", "create-ramonda", "dist", "index.js");
if (!existsSync(cli)) {
  console.error("[cli-gif] create-ramonda is not built — run `pnpm exec turbo run build --filter=create-ramonda`");
  process.exit(1);
}
const { SAY, MODE_OPTIONS, addOnOptions, DEFAULT_ADD_ONS, nextSteps } = await import(cli);

/*
 * A line is a list of [text, style] runs. The styles are the prompt library's: a step's symbol in
 * cyan while asked and green once answered, the rail and everything secondary dim.
 */
const bar = ["│  ", "dim"];
const asking = (message, extra = []) => [["◆  ", "cyan"], [message, "fg"], ...extra];
const answered = (message, answer) => [
  [
    ["◇  ", "green"],
    [message, "fg"],
  ],
  [bar, [answer, "dim"]],
  [["│", "dim"]],
];

function select(options, cursor) {
  return options.map((option, index) =>
    index === cursor
      ? [bar, ["● ", "green"], [option.label, "fg"], [` (${option.hint})`, "dim"]]
      : [bar, ["○ ", "dim"], [option.label, "dim"]],
  );
}

function multiselect(options, chosen, cursor) {
  return options.map((option, index) => {
    const on = chosen.includes(option.value);
    const mark = on ? ["◼ ", "green"] : ["◻ ", "dim"];
    return index === cursor
      ? [bar, mark, [option.label, "fg"], [` (${option.hint})`, "dim"]]
      : [bar, mark, [option.label, "dim"]];
  });
}

const confirm = (yes) => [
  bar,
  yes ? ["● ", "green"] : ["○ ", "dim"],
  ["Yes", yes ? "fg" : "dim"],
  [" / ", "dim"],
  yes ? ["○ ", "dim"] : ["● ", "green"],
  ["No", yes ? "dim" : "fg"],
];

/** The story: the defaults, with Query and Testing added, git and install taken. */
function story() {
  const frames = [];
  const command = "npm create ramonda@latest my-app";
  const shell = (typed) => [
    [
      ["$ ", "dim"],
      [typed, "fg"],
    ],
  ];
  for (let at = 4; at <= command.length; at += 4) frames.push({ lines: shell(command.slice(0, at)), ms: 60 });
  frames.push({ lines: shell(command), ms: 500 });

  const head = [
    ...shell(command),
    [],
    [
      ["┌  ", "dim"],
      [SAY.intro, "magenta"],
    ],
    [["│", "dim"]],
  ];
  frames.push({
    lines: [...head, asking(SAY.mode), ...select(MODE_OPTIONS, 0), [["└", "dim"]]],
    ms: 1600,
  });

  const afterMode = [...head, ...answered(SAY.mode, MODE_OPTIONS[0].label)];
  const options = addOnOptions("spa");
  const chosen = [...DEFAULT_ADD_ONS];
  const listing = (cursor, ms) =>
    frames.push({
      lines: [
        ...afterMode,
        asking(SAY.addons, [[` ${SAY.addonsKeys}`, "dim"]]),
        ...multiselect(options, chosen, cursor),
        [["└", "dim"]],
      ],
      ms,
    });
  let cursor = 0;
  listing(cursor, 1400);
  // Down to each one, a step at a time, and space on it.
  for (const want of ["query", "testing"]) {
    const target = options.findIndex((option) => option.value === want);
    while (cursor < target) listing(++cursor, 280);
    chosen.push(want);
    listing(cursor, 900);
  }
  const picked = options.filter((option) => chosen.includes(option.value)).map((option) => option.label);

  const afterAddons = [...afterMode, ...answered(SAY.addons, picked.join(", "))];
  frames.push({ lines: [...afterAddons, asking(SAY.git), confirm(true), [["└", "dim"]]], ms: 1000 });
  const afterGit = [...afterAddons, ...answered(SAY.git, "Yes")];
  frames.push({ lines: [...afterGit, asking(SAY.install("npm")), confirm(true), [["└", "dim"]]], ms: 1000 });

  const afterInstall = [...afterGit, ...answered(SAY.install("npm"), "Yes")];
  const done = [
    ...afterInstall,
    [
      ["◇  ", "green"],
      [SAY.scaffolded("my-app"), "fg"],
    ],
    [["│", "dim"]],
    [
      ["◇  ", "green"],
      [SAY.initialised, "fg"],
    ],
    [["│", "dim"]],
    [
      ["◇  ", "green"],
      [SAY.installed, "fg"],
    ],
    [["│", "dim"]],
  ];
  const steps = nextSteps("my-app", true, "npm");
  const inner = Math.max(...steps.map((line) => line.length)) + 2;
  const note = [
    [
      ["◇  ", "green"],
      [SAY.nextSteps, "fg"],
      [` ${"─".repeat(Math.max(2, inner - SAY.nextSteps.length - 1))}╮`, "dim"],
    ],
    [
      ["│", "dim"],
      [`${" ".repeat(inner + 2)}│`, "dim"],
    ],
    ...steps.map((line) => [
      ["│  ", "dim"],
      line.startsWith("$ ") ? ["$ ", "dim"] : ["", "fg"],
      [line.startsWith("$ ") ? line.slice(2) : line, line.startsWith("$ ") ? "fg" : "dim"],
      [`${" ".repeat(inner - line.length)}│`, "dim"],
    ]),
    [
      ["│", "dim"],
      [`${" ".repeat(inner + 2)}│`, "dim"],
    ],
    [
      ["├", "dim"],
      [`${"─".repeat(inner + 2)}╯`, "dim"],
    ],
    [
      ["●  ", "cyan"],
      [SAY.explained, "fg"],
    ],
    [["│", "dim"]],
    [
      ["└  ", "dim"],
      [SAY.outro, "fg"],
    ],
  ];
  frames.push({ lines: [...done, ...note], ms: 5200 });
  return frames;
}

/** The terminal's colours in each theme — GitHub's, like the code blocks and the editor GIFs. */
const THEMES = {
  light: {
    bg: "#ffffff",
    bar: "#f6f8fa",
    line: "#d0d7de",
    fg: "#1f2328",
    dim: "#6e7781",
    cyan: "#0969da",
    green: "#1a7f37",
    magenta: "#8250df",
  },
  dark: {
    bg: "#0d1117",
    bar: "#161b22",
    line: "#30363d",
    fg: "#e6edf3",
    dim: "#8b949e",
    cyan: "#58a6ff",
    green: "#3fb950",
    magenta: "#d2a8ff",
  },
};

const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * The tallest frame's lines and the longest line's characters — every frame is drawn that size, so
 * the GIF neither jumps nor takes the first frame's size for all of them.
 */
const SCREEN = 24;
const ROWS = (frames) => Math.min(SCREEN, Math.max(...frames.map((frame) => frame.lines.length)));
const COLUMNS = (frames) =>
  Math.max(...frames.flatMap((frame) => frame.lines.map((runs) => runs.map(([text]) => text).join("").length)));

function frameHtml(frame, theme, rows, columns) {
  const c = THEMES[theme];
  // A terminal scrolls: once there are more lines than fit, the newest stay and the oldest go.
  const body = frame.lines
    .slice(-rows)
    .map((runs) => runs.map(([text, style]) => `<span class="${style}">${escape(text)}</span>`).join(""))
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:${c.bg}}
    #shot{display:inline-block;background:${c.bg};border:1px solid ${c.line};border-radius:8px;overflow:hidden}
    .title{background:${c.bar};border-bottom:1px solid ${c.line};padding:7px 12px;font:12px system-ui,sans-serif;color:${c.dim}}
    pre{margin:0;padding:12px 16px;font:13px/19px ui-monospace,SFMono-Regular,Menlo,monospace;color:${c.fg};height:${rows * 19}px;white-space:pre;width:${columns}ch}
    .fg{color:${c.fg}}.dim{color:${c.dim}}.cyan{color:${c.cyan}}.green{color:${c.green}}.magenta{color:${c.magenta};font-weight:600}
  </style></head><body><div id="shot"><div class="title">Terminal</div><pre>${body}</pre></div></body></html>`;
}

const frames = story();
const rows = ROWS(frames);
const columns = COLUMNS(frames);
const stamps = existsSync(STAMPS) ? JSON.parse(readFileSync(STAMPS, "utf8")) : {};
const fromApp = createRequire(join(repo, "apps", "playground-core", "package.json"));

let stale = false;
for (const theme of Object.keys(THEMES)) {
  const name = theme === "light" ? "create-ramonda" : "create-ramonda-dark";
  const stamp = createHash("sha256")
    .update(JSON.stringify({ theme, frames, colours: THEMES[theme], rows, columns }))
    .digest("hex");
  const gif = join(OUT, `${name}.gif`);
  if (stamps[name] === stamp && existsSync(gif)) {
    console.log(`[cli-gif] ${name}.gif up to date`);
    continue;
  }
  if (check) {
    console.error(`[cli-gif] ${name}.gif was drawn from what the CLI said before — run node scripts/build-cli-gif.mjs`);
    stale = true;
    continue;
  }

  const { chromium } = fromApp("@playwright/test");
  const browser = await chromium.launch();
  const work = mkdtempSync(join(tmpdir(), "ramonda-cli-gif-"));
  try {
    const tab = await browser.newPage({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 1 });
    const list = [];
    let index = 0;
    for (const frame of frames) {
      await tab.setContent(frameHtml(frame, theme, rows, columns));
      const png = join(work, `${String(index++).padStart(4, "0")}.png`);
      await tab.locator("#shot").screenshot({ path: png });
      list.push(`file '${png}'\nduration ${(frame.ms / 1000).toFixed(3)}`);
    }
    // The concat demuxer drops the last frame's duration unless the frame is listed once more.
    list.push(list.at(-1).split("\n")[0]);
    writeFileSync(join(work, "frames.txt"), list.join("\n"));
    mkdirSync(OUT, { recursive: true });
    const made = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        join(work, "frames.txt"),
        "-vf",
        `pad=ceil(iw/2)*2:ceil(ih/2)*2:color=${theme === "light" ? "white" : "black"},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none`,
        "-loop",
        "0",
        gif,
      ],
      { encoding: "utf8" },
    );
    if (made.status !== 0) throw new Error(`ffmpeg could not write ${name}.gif:\n${made.stderr?.slice(-600)}`);
  } finally {
    await browser.close();
    rmSync(work, { recursive: true, force: true });
  }
  stamps[name] = stamp;
  writeFileSync(STAMPS, `${JSON.stringify(stamps, null, 2)}\n`);
  console.log(`[cli-gif] drew ${name}.gif — ${frames.length} frames`);
}
if (stale) process.exit(1);
