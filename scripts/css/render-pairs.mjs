/**
 * The pairs `check-render-equality.mjs` renders: the same styles written by hand and written as
 * blocks. See that file for what is compared and why.
 *
 * A pair is one page. `hand` is the stylesheet a person would write — grouped rules, in the order
 * that decides them. `blocks` is the same thing as blocks, one per class, in the SAME order: the
 * classes on an element are merged in that order, so a later block wins as a later rule does.
 * `markup` uses the class names; on the block page each name becomes its compiled classes.
 *
 * `shared` is source written above every block's module — a `@@keyframes` a block names. A block may
 * spread another of the pair, `...$(base)`, and it is then imported from that block's own module.
 *
 * Every element is sized and outlined, so a declaration that goes wrong moves or recolours
 * something the picture shows. A pair earns its place by a fault it would have caught — the
 * comment says which.
 */

/** A frame that makes a box's padding, border and size visible. */
const BOX = "outline: 1px solid black; width: 160px; font: 16px/1.2 serif;";

/**
 * An image that is really there, so a layer that goes wrong — its position, size or repeat — moves
 * something the picture shows. A missing file draws nothing, and a split could get all of it wrong.
 */
const IMAGE = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'><rect width='6' height='6' fill='red'/></svg>")`;

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
    // An ordinary longhand after an important split: the important piece must stay. The merge once
    // keyed both `pl` and kept the later, ordinary one.
    name: "!important split, then an ordinary longhand",
    hand: `.a { padding: 4px !important; background: #ddd; } .b { padding-left: 40px; }`,
    blocks: { a: "padding: 4px !important; background: #ddd;", b: "padding-left: 40px;" },
    markup: `<div class="a b" style="${BOX}">text</div>`,
  },
  {
    name: "a condition over the unconditional rule",
    hand: `.a { color: red; } @media (min-width: 1px) { .b { color: blue; } }`,
    blocks: { a: "color: red;", b: "@media (min-width: 1px) { color: blue; }" },
    markup: `<div class="a b" style="${BOX}">text</div>`,
  },
  {
    // A condition that does NOT hold: the block's rule must stay out, as the hand-written one does.
    // Every other condition here is true, so a condition dropped on the way would pass them all.
    name: "a condition that does not hold",
    hand: `.a { color: red; padding: 4px; } @media (max-width: 1px) { .b { color: blue; padding-left: 40px; } }`,
    blocks: { a: "color: red; padding: 4px;", b: "@media (max-width: 1px) { color: blue; padding-left: 40px; }" },
    markup: `<div class="a b" style="${BOX}">text</div>`,
  },
  {
    // Layers, each read on its own; the colour only from the last.
    name: "background in layers",
    hand: `.a { background: linear-gradient(red, blue) no-repeat 10px 10px / 30px 20px, ${IMAGE} repeat-x 0 30px, #ffc; }`,
    blocks: {
      a: `background: linear-gradient(red, blue) no-repeat 10px 10px / 30px 20px, ${IMAGE} repeat-x 0 30px, #ffc;`,
    },
    markup: `<div class="a" style="${BOX} height: 60px;"></div>`,
  },
  {
    // A whole `background` in `v`, a longhand after it in `u`.
    name: "background, then a longhand",
    hand: `.a { background: #ccc ${IMAGE} no-repeat 4px 4px; } .b { background-color: #9cf; }`,
    blocks: { a: `background: #ccc ${IMAGE} no-repeat 4px 4px;`, b: "background-color: #9cf;" },
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
    // `animation` split — name, duration, fill mode — and the picture taken at the last frame, which
    // only `forwards` keeps. The keyframes are the author's in one and a compiled `@@keyframes` in
    // the other, named by a hash.
    name: "an animation that fills forwards",
    hand: `@keyframes grow { from { width: 10px; } to { width: 120px; } } .a { background: #9cf; height: 20px; animation: grow 1s ease-in forwards; }`,
    shared: "const grow = @@keyframes( from { width: 10px; } to { width: 120px; } );\n",
    blocks: { a: "background: #9cf; height: 20px; animation: $(grow) 1s ease-in forwards;" },
    markup: `<div class="a"></div>`,
  },
  {
    // A REGISTERED property animated by compiled frames and read by a block — `@@property`, then
    // `@@keyframes` setting it through its binding, then `var($(angle))`. Only a registered `<angle>`
    // interpolates, so a registration that went wrong leaves the bar unturned; the picture is the
    // last frame, which `forwards` keeps.
    name: "a registered property turned by an animation",
    hand:
      `@property --angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; } ` +
      `@keyframes turn { from { --angle: 0deg; } to { --angle: 60deg; } } ` +
      `.a { background: #9cf; width: 120px; height: 16px; transform: rotate(var(--angle)); animation: turn 1s linear forwards; }`,
    shared:
      `const angle = @@property( syntax: "<angle>"; inherits: false; initial-value: 0deg; );\n` +
      `const turn = @@keyframes( from { $(angle): 0deg; } to { $(angle): 60deg; } );\n`,
    blocks: {
      a: "background: #9cf; width: 120px; height: 16px; transform: rotate(var($(angle))); animation: $(turn) 1s linear forwards;",
    },
    markup: `<div class="a"></div>`,
  },
  {
    // A spread of a block from ANOTHER module, then a longhand below it — the base's split pieces
    // against the card's written longhand, each from its own stylesheet.
    name: "a spread from another module, then a longhand",
    hand: `.card { padding: 8px; border: 2px solid #999; background: #eee; padding-left: 40px; }`,
    blocks: {
      base: "padding: 8px; border: 2px solid #999; background: #eee;",
      card: "...$(base); padding-left: 40px;",
    },
    markup: `<div class="card" style="${BOX}">text</div>`,
  },
  {
    // A state the test has to drive.
    name: "a hover state",
    hand: `.a { background: #ddd; padding: 4px; } .a:hover { background: #9cf; padding-left: 20px; }`,
    blocks: { a: "background: #ddd; padding: 4px; &:hover { background: #9cf; padding-left: 20px; }" },
    markup: `<div class="a" id="hovered" style="${BOX}">hover me</div>`,
    hover: "#hovered",
  },

  /*
   * The block's logic, one pair per STATE — `shared` fixes the condition, and the hand-written page
   * is what that state means in plain CSS. Each pair puts a choice, a chain or a match against the
   * things that decide the cascade here: a split shorthand, the layer, a later longhand, a spread.
   */
  {
    // A branch's shorthand after an unconditional longhand clears it, as a later shorthand does.
    name: "a branch's shorthand after a longhand",
    shared: "const on = true;\n",
    hand: `.a { padding-left: 40px; background: #ddd; } .b { padding: 8px; }`,
    blocks: { a: "padding-left: 40px; background: #ddd;", b: "when $(on) { padding: 8px; } else { padding: 2px; }" },
    markup: `<div class="a b" style="${BOX}">text</div>`,
  },
  {
    // The `else` of the same chain: the other branch, and nothing of the first.
    name: "the else of a chain",
    shared: "const on = false;\n",
    hand: `.a { padding-left: 40px; background: #ddd; } .b { padding: 2px; }`,
    blocks: { a: "padding-left: 40px; background: #ddd;", b: "when $(on) { padding: 8px; } else { padding: 2px; }" },
    markup: `<div class="a b" style="${BOX}">text</div>`,
  },
  {
    // A choice between two shorthands, then a longhand after it: the longhand wins, by the layer.
    name: "a choice of shorthands, then a longhand",
    shared: "const on = true;\n",
    hand: `.a { border: 6px solid red; border-top-color: blue; background: #ddd; }`,
    blocks: { a: "border: $(on) ? 6px solid red : 1px solid #ccc; border-top-color: blue; background: #ddd;" },
    markup: `<div class="a" style="${BOX} height: 40px;"></div>`,
  },
  {
    // The other branch of the same choice — its shorthand clears what the first would have set.
    name: "the other branch of a choice",
    shared: "const on = false;\n",
    hand: `.a { border: 1px solid #ccc; border-top-color: blue; background: #ddd; }`,
    blocks: { a: "border: $(on) ? 6px solid red : 1px solid #ccc; border-top-color: blue; background: #ddd;" },
    markup: `<div class="a" style="${BOX} height: 40px;"></div>`,
  },
  {
    // A chain of choices, middle branch.
    name: "the middle of a choice chain",
    shared: "const a = false;\nconst b = true;\n",
    hand: `.x { background: #9cf; height: 30px; }`,
    blocks: { x: "background: $(a) ? red : $(b) ? #9cf : gray; height: 30px;" },
    markup: `<div class="x" style="${BOX}"></div>`,
  },
  {
    // A match over whole groups, a shorthand in its arm, and a longhand after the match.
    name: "a match arm's shorthand, then a longhand",
    shared: 'const size = "large";\n',
    hand: `.a { padding: 6px 12px; font-size: 18px; padding-left: 40px; background: #ddd; }`,
    blocks: {
      a: "match $(size) { small => ( padding: 2px 6px; font-size: 12px; ); large => ( padding: 6px 12px; font-size: 18px; ); } padding-left: 40px; background: #ddd;",
    },
    markup: `<div class="a" style="${BOX}">text</div>`,
  },
  {
    // An arm holding a nested rule: the hover lands with the arm.
    name: "a match arm with a hover in it",
    shared: 'const tone = "hot";\n',
    hand: `.a { color: red; background: #eee; } .a:hover { color: darkred; background: #9cf; }`,
    blocks: {
      a: "match $(tone) { hot => ( color: red; background: #eee; &:hover { color: darkred; background: #9cf; } ); _ => ( color: gray; ); }",
    },
    markup: `<div class="a" id="hovered" style="${BOX}">hover me</div>`,
    hover: "#hovered",
  },
  {
    // A spread inside an `else`: the base lands whole, and a later declaration still wins.
    name: "a spread in an else",
    shared: "const off = false;\n",
    hand: `.card { padding: 8px; background: #ddd; padding-left: 40px; }`,
    blocks: {
      base: "padding: 8px; background: #ddd;",
      card: "when $(off) { color: red; } else { ...$(base); } padding-left: 40px;",
    },
    markup: `<div class="card" style="${BOX}">text</div>`,
  },

  /* The logic NESTED, where two of the things that decide a cascade meet inside each other. */
  {
    name: "a chain in a hover in a media query",
    shared: "const p = false;\nconst q = true;\n",
    hand: `.a { background: #ddd; height: 30px; } @media (min-width: 1px) { .a:hover { background: #9cf; } }`,
    blocks: {
      a: "background: #ddd; height: 30px; @media (min-width: 1px) { &:hover { when $(p) { background: red; } else when $(q) { background: #9cf; } else { background: gray; } } }",
    },
    markup: `<div class="a" id="hovered" style="${BOX}"></div>`,
    hover: "#hovered",
  },
  {
    name: "a block match inside a condition",
    shared: 'const on = true;\nconst size = "large";\n',
    hand: `.a { padding: 6px 12px; background: #ddd; }`,
    blocks: {
      a: "padding: 1px; when $(on) { match $(size) { small => ( padding: 2px 6px; ); large => ( padding: 6px 12px; ); } } background: #ddd;",
    },
    markup: `<div class="a" style="${BOX}">text</div>`,
  },
  {
    name: "a choice on a nested element",
    shared: "const on = true;\n",
    hand: `.a { background: #eee; } .a span { color: red; border-bottom: 3px solid red; }`,
    blocks: {
      a: "background: #eee; & span { color: $(on) ? red : blue; border-bottom: $(on) ? 3px solid red : none; }",
    },
    markup: `<div class="a" style="${BOX}"><span>text</span></div>`,
  },
  {
    name: "a block match beside a spread, in an else",
    shared: 'const off = false;\nconst t = "x";\n',
    hand: `.card { padding: 8px; background: #ddd; padding-left: 40px; }`,
    blocks: {
      base: "padding: 8px; background: #ddd;",
      card: "when $(off) { color: red; } else { ...$(base); match $(t) { x => ( padding-left: 40px; ); _ => ( padding-left: 2px; ); } }",
    },
    markup: `<div class="card" style="${BOX}">text</div>`,
  },
];
