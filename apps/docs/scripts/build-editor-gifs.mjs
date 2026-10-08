/**
 * Renders the two GIFs of an editor writing a style block — `public/media/style-blocks-*.gif`.
 *
 *   node scripts/build-editor-gifs.mjs          # render them
 *   node scripts/build-editor-gifs.mjs --check  # fail if what the editor says has moved since
 *
 * ## Drawn, not recorded — and drawn from the editor's own answers
 *
 * A screen recording goes stale silently: the plugin changes a message and the picture still shows
 * the old one. So nothing here is typed into an editor. Every completion list, squiggle and hover is
 * ASKED of the real TypeScript language service with this repository's own editor plugin loaded,
 * over the playground app — its config, its tokens, its rules — and only then drawn: the code
 * coloured by the grammars the extension ships, the overlays placed where the answers say. The last
 * frame of the first GIF is the block's real CSS, compiled by the build's own compiler and rendered
 * in Chromium.
 *
 * What is drawn is therefore what an editor with the plugin says, and `--check` asks it again: the
 * answers and the frames' text are hashed into a stamp beside each GIF, the way `preview.png` in
 * `tools/vscode-css` is. A changed message is a failing check, not a picture that lies.
 *
 * It needs `@ramonda/css` built (the plugin and compiler come from `dist`), Chromium from the
 * playground's Playwright, and `ffmpeg` — which `scripts/shots.mjs` already relies on.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { highlighter } from "./highlighter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const APP = join(repo, "apps", "playground-core");
const OUT = join(here, "..", "public", "media");
const check = process.argv.includes("--check");

const fromApp = createRequire(join(APP, "package.json"));
const ts = fromApp("typescript");
const init = createRequire(import.meta.url)(join(repo, "packages", "css", "dist", "plugin.cjs"));
const { transform, Sheet } = await import(join(repo, "packages", "css", "dist", "compiler", "index.js"));

/**
 * The language service an editor runs over the playground, with the plugin loaded — the same
 * wiring `plugin.test.ts` uses, over a real project rather than a fixture. The file being written
 * lives only in memory, at a path inside the app, so the project's config and tokens apply to it.
 */
const FILE = join(APP, "src", "demos", "Badge.tsx");
const parsed = ts.getParsedCommandLineOfConfigFile(
  join(APP, "tsconfig.json"),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
);
let text = "";
let version = 0;
const host = {
  getScriptFileNames: () => [...parsed.fileNames.filter((one) => one !== FILE), FILE],
  getScriptVersion: (name) => (name === FILE ? String(version) : "1"),
  getScriptSnapshot: (name) => {
    const read = name === FILE ? text : ts.sys.readFile(name);
    return read === undefined ? undefined : ts.ScriptSnapshot.fromString(read);
  },
  getCurrentDirectory: () => APP,
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  fileExists: (name) => name === FILE || ts.sys.fileExists(name),
  readFile: (name) => (name === FILE ? text : ts.sys.readFile(name)),
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};
const plain = ts.createLanguageService(host);
host.getSourceFileLike = (name) => plain.getProgram()?.getSourceFile(name);
const service = init({ typescript: ts }).create({
  languageService: plain,
  languageServiceHost: host,
  config: {},
  project: {},
});

const write = (next) => {
  text = next;
  version++;
};

/** The completions an editor shows for the word before the caret: its own filter, over the plugin's list. */
function completions(caret) {
  const word = /[\w$-]*$/.exec(text.slice(0, caret))[0].replace(/^.*\./, "");
  const entries = service.getCompletionsAtPosition(FILE, caret, {})?.entries ?? [];
  return entries
    .filter((one) => one.name.toLowerCase().startsWith(word.toLowerCase()))
    .sort((a, b) => (a.sortText ?? "").localeCompare(b.sortText ?? "") || a.name.localeCompare(b.name))
    .slice(0, 7)
    .map((one) => one.name);
}

/** The squiggles: each diagnostic's span and the first line of what it says. */
function squiggles() {
  return service.getSemanticDiagnostics(FILE).map((one) => ({
    start: one.start,
    length: one.length,
    message: ts.flattenDiagnosticMessageText(one.messageText, "\n").split("\n")[0],
  }));
}

/** What a hover over this offset says: the signature, and the first line of the documentation. */
function hover(at) {
  const info = service.getQuickInfoAtPosition(FILE, at);
  const signature = ts.displayPartsToString(info?.displayParts ?? []);
  const doc = ts.displayPartsToString(info?.documentation ?? []).split("\n")[0];
  return [signature, doc].filter(Boolean).join("\n");
}

const HEAD = `import { Component } from "@ramonda/core";\n\nexport class Badge extends Component {\n  render() {\n    return <span className={@@(\n`;
const TAIL = `\n    )}>Online</span>;\n  }\n}\n`;
const INDENT = "      ";

/**
 * A storyboard: frames of text, a caret and what the editor shows, each held for a time.
 *
 * `typing` adds one character a frame, the way a person types; the rest hold a moment long enough
 * to read. Everything shown — a list, a squiggle, a hover — is asked of the service at that frame.
 */
class Story {
  frames = [];
  body = "";

  frame(extra = {}, ms = 90) {
    write(HEAD + this.body + TAIL);
    this.frames.push({ text, caret: HEAD.length + this.body.length, squiggles: squiggles(), ...extra, ms });
  }

  typing(chars, { popupFrom } = {}) {
    for (const char of chars) {
      this.body += char;
      const caret = HEAD.length + this.body.length;
      write(HEAD + this.body + TAIL);
      const popup = popupFrom !== undefined && this.body.length >= popupFrom ? completions(caret) : undefined;
      this.frame(popup === undefined || popup.length === 0 ? {} : { popup }, char === "\n" ? 140 : 70);
    }
  }

  hold(ms, extra = {}) {
    this.frame(extra, ms);
  }
}

/** First GIF: write a block, misspell a property, read what the editor says, fix it, see the page. */
function writing() {
  const story = new Story();
  story.body = `${INDENT}padding: 4px 12px;\n${INDENT}border-radius: 999px;\n${INDENT}background: $color.surface.sunken;\n${INDENT}`;
  story.hold(900);
  const from = story.body.length;
  story.typing("disp", { popupFrom: from + 1 });
  story.hold(900, { popup: completions(HEAD.length + story.body.length) });
  story.body = story.body.slice(0, -4) + "display";
  story.hold(250);
  story.typing(`: inline-flex;\n${INDENT}gap: 8px;\n${INDENT}colr: $color.accent.main;`);
  story.hold(700);
  const wrong = squiggles()[0];
  story.hold(2600, { tooltip: { at: wrong.start, text: wrong.message } });
  story.body = story.body.replace("colr:", "color:");
  story.hold(1400);
  return story;
}

/** Second GIF: what the editor offers and says inside a block. */
function editing() {
  const story = new Story();
  story.body = `${INDENT}display: inline-flex;\n${INDENT}`;
  story.hold(700);
  const from = story.body.length;
  story.typing("background: $color.", { popupFrom: from + 18 });
  story.hold(1100, { popup: completions(HEAD.length + story.body.length) });
  story.body += "surface.";
  story.hold(900, { popup: completions(HEAD.length + story.body.length) });
  story.typing("sunken;");
  story.hold(500);
  const display = HEAD.length + story.body.indexOf("display") + 2;
  story.hold(2600, { tooltip: { at: display - 2, text: hover(display) } });
  story.typing(`\n${INDENT}z-index: 5;`);
  const refused = squiggles().find((one) => text.slice(one.start, one.start + one.length) === "5");
  story.hold(2800, { tooltip: { at: refused.start, text: refused.message } });
  return story;
}

/** The block's real CSS and classes, rendered — the last frame of the first GIF. */
function compiled(source) {
  const result = transform(source, { filename: FILE });
  const sheet = new Sheet();
  sheet.add(FILE, result.blocks);
  const classes = /"(r-[^"]+)"/.exec(result.code)[1];
  const tokens = readFileSync(join(APP, "css-system", "tokens.css"), "utf8");
  return { classes, css: tokens + sheet.cssFor(FILE) };
}

const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Where an offset sits, as a line and a column of the text. */
function place(offset, of) {
  const before = of.slice(0, offset).split("\n");
  return { line: before.length - 1, column: before.at(-1).length };
}

const LINE = 24;
/**
 * The two themes each GIF is drawn in. The site follows the reader's `prefers-color-scheme`, and a
 * light editor on a dark page is a white slab — so each GIF has a dark twin, chosen by the same
 * query (see `Markdown.tsx`). The colours are GitHub's own light and dark, to sit beside the code
 * blocks the site highlights with the same two themes.
 */
const THEMES = {
  light: {
    shiki: "github-light",
    vars: "--bg:#fff;--bar:#f6f8fa;--line:#d0d7de;--muted:#57606a;--gutter:#8c959f;--caret:#0969da;--squig:%23cf222e;--on:#ddf4ff;--fg:#1f2328;--shadow:rgba(140,149,159,.25)",
  },
  dark: {
    shiki: "github-dark",
    vars: "--bg:#0d1117;--bar:#161b22;--line:#30363d;--muted:#8b949e;--gutter:#6e7681;--caret:#2f81f7;--squig:%23f85149;--on:#13233a;--fg:#e6edf3;--shadow:rgba(1,4,9,.8)",
  },
};

const style = (theme) => `
  :root{${THEMES[theme].vars.replace("%23", "#")}}
  html,body{margin:0;background:var(--bg)}
  #shot{width:760px;height:400px;box-sizing:border-box;font:14px/${LINE}px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .bar{height:30px;background:var(--bar);border-bottom:1px solid var(--line);font:12px/30px -apple-system,system-ui,sans-serif;color:var(--muted);padding:0 14px}
  .body{position:relative;padding:12px 0 16px 0;display:flex}
  .gutter{width:40px;text-align:right;color:var(--gutter);padding-right:14px;white-space:pre}
  .code{position:relative;flex:1}
  .code pre{margin:0;padding:0;background:transparent!important;font:inherit}
  .caret{position:absolute;width:2px;height:${LINE - 4}px;background:var(--caret)}
  .squiggle{position:absolute;height:3px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='M0 2 L1.5 0.5 L3 2 L4.5 0.5 L6 2' stroke='${THEMES[theme].vars.match(/--squig:([^;]+)/)[1]}' fill='none'/%3E%3C/svg%3E") repeat-x}
  .popup{position:absolute;min-width:220px;background:var(--bar);border:1px solid var(--line);border-radius:6px;box-shadow:0 8px 24px var(--shadow);padding:4px 0}
  .popup div{padding:0 10px;height:22px;line-height:22px;white-space:pre}
  .popup .on{background:var(--on)}
  .tip{position:absolute;max-width:520px;background:var(--bar);border:1px solid var(--line);border-radius:6px;box-shadow:0 8px 24px var(--shadow);padding:8px 10px;font:12.5px/18px ui-monospace,Menlo,monospace;color:var(--fg);white-space:pre-wrap}
  .page{padding:28px;background:var(--bg);font:15px -apple-system,system-ui,sans-serif}
  .page .url{font:12px -apple-system,system-ui,sans-serif;color:var(--muted);margin-bottom:18px}
`;

/** One frame as a page: the code coloured by the extension's grammars, and the overlays the answers place. */
function frameHtml(frame, theme) {
  const code = highlighter.codeToHtml(frame.text, { lang: "tsx", theme: THEMES[theme].shiki });
  const lines = frame.text.split("\n").length;
  const at = (offset) => {
    const { line, column } = place(offset, frame.text);
    return { top: line * LINE, left: `${column}ch` };
  };
  const overlays = [];
  for (const one of frame.squiggles) {
    const { top, left } = at(one.start);
    overlays.push(`<div class="squiggle" style="top:${top + LINE - 5}px;left:${left};width:${one.length}ch"></div>`);
  }
  const caret = at(frame.caret);
  overlays.push(`<div class="caret" style="top:${caret.top + 2}px;left:${caret.left}"></div>`);
  if (frame.popup !== undefined) {
    overlays.push(
      `<div class="popup" style="top:${caret.top + LINE + 2}px;left:calc(${caret.left} - 4ch)">` +
        frame.popup.map((name, index) => `<div class="${index === 0 ? "on" : ""}">${escape(name)}</div>`).join("") +
        "</div>",
    );
  }
  if (frame.tooltip !== undefined) {
    const { top, left } = at(frame.tooltip.at);
    overlays.push(`<div class="tip" style="top:${top + LINE + 4}px;left:${left}">${escape(frame.tooltip.text)}</div>`);
  }
  const numbers = Array.from({ length: lines }, (_, index) => index + 1).join("\n");
  return (
    `<!doctype html><style>${style(theme)}</style><div id="shot"><div class="bar">Badge.tsx</div>` +
    `<div class="body"><div class="gutter">${numbers}</div><div class="code">${code}${overlays.join("")}</div></div></div>`
  );
}

/** The last frame of the first GIF: the element, with the CSS the build made of the block. */
function pageHtml(source, theme) {
  const { classes, css } = compiled(source);
  return (
    `<!doctype html><style>${style(theme)}${css}</style><div id="shot"><div class="bar">In the browser</div>` +
    `<div class="page"><div class="url">The same block, built — classes from the compiler, CSS from the sheet:</div>` +
    `<span class="${escape(classes)}">Online</span></div></div>`
  );
}

/**
 * What each GIF was drawn from, hashed — beside this script rather than beside the GIFs, because
 * everything in `public/` is deployed and a stamp is no use to a reader.
 */
const STAMPS = join(here, "editor-gifs.stamp.json");
const stamps = existsSync(STAMPS) ? JSON.parse(readFileSync(STAMPS, "utf8")) : {};

const stories = [
  { name: "style-blocks-write", story: writing(), page: true },
  { name: "style-blocks-editor", story: editing(), page: false },
];

let stale = false;
for (const { name: base, story, page } of stories)
  for (const theme of Object.keys(THEMES)) {
    const name = theme === "light" ? base : `${base}-${theme}`;
    const last = story.frames.at(-1).text;
    const what = JSON.stringify({ theme, frames: story.frames, page: page ? compiled(last) : null });
    const stamp = createHash("sha256").update(what).digest("hex");
    const gif = join(OUT, `${name}.gif`);
    const held = stamps[name] ?? "";
    if (held === stamp && existsSync(gif)) {
      console.log(`[gifs] ${name}.gif up to date`);
      continue;
    }
    if (check) {
      console.error(
        `[gifs] ${name}.gif was drawn from what the editor said before — run node scripts/build-editor-gifs.mjs`,
      );
      stale = true;
      continue;
    }

    const { chromium } = fromApp("@playwright/test");
    const browser = await chromium.launch();
    const work = mkdtempSync(join(tmpdir(), "ramonda-gif-"));
    try {
      const tab = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
      const list = [];
      const shoot = async (html, ms, index) => {
        await tab.setContent(html);
        const png = join(work, `${String(index).padStart(4, "0")}.png`);
        await tab.locator("#shot").screenshot({ path: png });
        list.push(`file '${png}'\nduration ${(ms / 1000).toFixed(3)}`);
      };
      let index = 0;
      for (const frame of story.frames) await shoot(frameHtml(frame, theme), frame.ms, index++);
      if (page) await shoot(pageHtml(last, theme), 3200, index++);
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
    console.log(`[gifs] drew ${name}.gif — ${story.frames.length + (page ? 1 : 0)} frames`);
  }
if (stale) process.exit(1);
