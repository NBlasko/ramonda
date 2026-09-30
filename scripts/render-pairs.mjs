/**
 * The pairs `check-render-equality.mjs` renders: the same styles written by hand and written as
 * blocks. See that file for what is compared and why.
 *
 * A pair is one page. `hand` is the stylesheet a person would write — grouped rules, in the order
 * that decides them. `blocks` is the same thing as blocks, one per class, in the SAME order: the
 * classes on an element are merged in that order, so a later block wins as a later rule does.
 * `markup` uses the class names; on the block page each name becomes its compiled classes.
 *
 * Every element is sized and outlined, so a declaration that goes wrong moves or recolours
 * something the picture shows. A pair earns its place by a fault it would have caught — the
 * comment says which.
 */

/** A frame that makes a box's padding, border and size visible. */
const BOX = "outline: 1px solid black; width: 160px; font: 16px/1.2 serif;";

export const PAIRS = [
  {
    // A longhand written after its shorthand wins — the layer is what decides it.
    name: "shorthand, then longhand",
    hand: `.a { padding: 8px; background: #ddd; } .b { padding-left: 40px; }`,
    blocks: { a: "padding: 8px; background: #ddd;", b: "padding-left: 40px;" },
    markup: `<div class="a b" style="${BOX}">text</div>`,
  },
  {
    // A shorthand written after its longhand clears it — the merge decides that one.
    name: "longhand, then shorthand",
    hand: `.a { padding-left: 40px; background: #ddd; } .b { padding: 8px; }`,
    blocks: { a: "padding-left: 40px; background: #ddd;", b: "padding: 8px;" },
    markup: `<div class="a b" style="${BOX}">text</div>`,
  },
  {
    // CSS reads layer order backwards for !important; the mirror under `i` puts it right.
    name: "!important, shorthand then longhand",
    hand: `.a { background: red !important; } .b { background-color: blue !important; }`,
    blocks: { a: "background: red !important;", b: "background-color: blue !important;" },
    markup: `<div class="a b" style="${BOX} height: 40px;"></div>`,
  },
  {
    name: "a condition over the unconditional rule",
    hand: `.a { color: red; } @media (min-width: 1px) { .b { color: blue; } }`,
    blocks: { a: "color: red;", b: "@media (min-width: 1px) { color: blue; }" },
    markup: `<div class="a b" style="${BOX}">text</div>`,
  },
  {
    // Layers, each read on its own; the colour only from the last.
    name: "background in layers",
    hand: `.a { background: linear-gradient(red, blue) no-repeat 10px 10px / 30px 20px, url(missing.png), #ffc; }`,
    blocks: { a: "background: linear-gradient(red, blue) no-repeat 10px 10px / 30px 20px, url(missing.png), #ffc;" },
    markup: `<div class="a" style="${BOX} height: 60px;"></div>`,
  },
  {
    // A whole `background` in `v`, a longhand after it in `u`.
    name: "background, then a longhand",
    hand: `.a { background: #ccc url(missing.png); } .b { background-color: #9cf; }`,
    blocks: { a: "background: #ccc url(missing.png);", b: "background-color: #9cf;" },
    markup: `<div class="a b" style="${BOX} height: 40px;"></div>`,
  },
  {
    // A shorthand that reaches the sheet whole — a `var()` — and a longhand after it.
    name: "border with a var(), then a longhand",
    hand: `.a { --b: 6px solid green; border: var(--b); } .b { border-top-color: red; }`,
    blocks: { a: "--b: 6px solid green; border: var(--b);", b: "border-top-color: red;" },
    markup: `<div class="a b" style="${BOX} height: 40px;"></div>`,
  },
  {
    // `font` resets every font longhand, most of them inherited: a split that left one out would
    // take the parent's value, and the parent here sets two.
    name: "font resets what it does not set",
    hand: `.p { font-variant-caps: small-caps; font-weight: bold; } .a { font: 20px serif; }`,
    blocks: { p: "font-variant-caps: small-caps; font-weight: bold;", a: "font: 20px serif;" },
    markup: `<div class="p" style="${BOX}"><span class="a">Text</span></div>`,
  },
  {
    // A system font does not split; a longhand after it must still win.
    name: "a system font, then a longhand",
    hand: `.a { font: caption; } .b { font-weight: bold; }`,
    blocks: { a: "font: caption;", b: "font-weight: bold;" },
    markup: `<div class="a b" style="${BOX}">Text</div>`,
  },
  {
    // `grid-column: 2` ends at `auto`, not at 2 — the split once put the end at 2.
    name: "a grid line alone",
    hand: `.g { display: grid; grid-template-columns: 40px 40px 40px; gap: 4px; } .i { grid-column: 2; background: #9cf; height: 20px; }`,
    blocks: {
      g: "display: grid; grid-template-columns: 40px 40px 40px; gap: 4px;",
      i: "grid-column: 2; background: #9cf; height: 20px;",
    },
    markup: `<div class="g" style="${BOX}"><div class="i"></div></div>`,
  },
  {
    // Area strings, and line names that meet between two rows.
    name: "grid-template with areas",
    hand:
      `.g { display: grid; grid-template: [top] "h h" 20px [mid] "s m" 30px / 40px 1fr; gap: 2px; } ` +
      `.h { grid-area: h; background: #fc9; } .s { grid-area: s; background: #9cf; } .m { grid-area: m; background: #cf9; }`,
    blocks: {
      g: `display: grid; grid-template: [top] "h h" 20px [mid] "s m" 30px / 40px 1fr; gap: 2px;`,
      h: "grid-area: h; background: #fc9;",
      s: "grid-area: s; background: #9cf;",
      m: "grid-area: m; background: #cf9;",
    },
    markup: `<div class="g" style="${BOX}"><div class="h"></div><div class="s"></div><div class="m"></div></div>`,
  },
  {
    // A two-word alignment value, which the positional table could not split.
    name: "place-items: first baseline",
    hand: `.g { display: grid; grid-template-columns: 1fr 1fr; place-items: first baseline; height: 50px; }`,
    blocks: { g: "display: grid; grid-template-columns: 1fr 1fr; place-items: first baseline; height: 50px;" },
    markup: `<div class="g" style="${BOX}"><span style="font-size: 24px">A</span><span>b</span></div>`,
  },
  {
    name: "flex, and flex-basis after it",
    hand: `.f { display: flex; } .x { flex: 1; background: #9cf; } .y { flex: 2 1 10px; background: #fc9; } .z { flex-basis: 60px; }`,
    blocks: {
      f: "display: flex;",
      x: "flex: 1; background: #9cf;",
      y: "flex: 2 1 10px; background: #fc9;",
      z: "flex-basis: 60px;",
    },
    markup: `<div class="f" style="${BOX} height: 20px;"><div class="x"></div><div class="y z"></div></div>`,
  },
  {
    name: "border-radius with a slash",
    hand: `.a { border-radius: 4px 12px 20px 2px / 10px; background: #9cf; }`,
    blocks: { a: "border-radius: 4px 12px 20px 2px / 10px; background: #9cf;" },
    markup: `<div class="a" style="${BOX} height: 40px;"></div>`,
  },
  {
    name: "text-decoration, two lines and a colour",
    hand: `.a { text-decoration: underline overline wavy red 2px; }`,
    blocks: { a: "text-decoration: underline overline wavy red 2px;" },
    markup: `<div class="a" style="${BOX}">decorated</div>`,
  },
  {
    // A state the test has to drive.
    name: "a hover state",
    hand: `.a { background: #ddd; padding: 4px; } .a:hover { background: #9cf; padding-left: 20px; }`,
    blocks: { a: "background: #ddd; padding: 4px; &:hover { background: #9cf; padding-left: 20px; }" },
    markup: `<div class="a" id="hovered" style="${BOX}">hover me</div>`,
    hover: "#hovered",
  },
];
