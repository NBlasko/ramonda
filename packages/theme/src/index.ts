/**
 * Ramonda's theme: the one place a colour is named.
 *
 * ## Why this is a package and not a file
 *
 * Three surfaces draw Ramonda — the devtools panel, the documentation site, and the logo — and all
 * three were spelling out the same brand purple independently. They cannot share a plain file
 * because they live in different workspaces; they can share a workspace package.
 *
 * ## Why it is private, and how a published package still uses it
 *
 * `@ramonda/devtools` is published, and it depends on this. That works because devtools declares no
 * runtime dependencies at all — everything is a `devDependency` and tsup inlines it, which is
 * already how `@ramonda/shared` reaches the same packages. Nothing here is ever resolved by somebody
 * installing Ramonda; the values are in the bundle by the time they see it.
 *
 * ## Why it is one file
 *
 * So that a plain `node` script can import it. `apps/docs` generates its stylesheet and its four
 * logo files from these values at build time, and Node needs a complete path with the extension on
 * it — which a module with imports of its own cannot give, because a consumer's `tsc` rejects the
 * `.ts` extension Node requires. One file has no internal imports, so both resolvers agree.
 */

/** The prefix every Ramonda custom property carries, so a token can never collide with a page's own. */
const PREFIX = "--rmd";

/**
 * A token object as a block of CSS custom properties.
 *
 * Written for a stylesheet the panel injects into its own shadow root and for a file the docs site
 * links, which is why the selector is a parameter rather than always `:root`.
 */
export function declarations(tokens: Record<string, string>, indent = "  "): string {
  return Object.entries(tokens)
    .map(([name, value]) => `${indent}${PREFIX}-${name}: ${lowerHex(value)};`)
    .join("\n");
}

/**
 * Hex, lowercased on the way out.
 *
 * The table above is written in upper case because that is how the brand is written down, and a
 * stylesheet generated from it has to come out byte-identical to what `biome format` would produce
 * — biome lowercases hex in CSS. Without this the generated file and the formatter rewrite each
 * other forever, and CI fails on whichever ran last.
 */
const lowerHex = (value: string): string => value.replace(/#[0-9A-Fa-f]{3,8}\b/g, (hex) => hex.toLowerCase());

/**
 * The marks. Five colours that are Ramonda wherever it appears.
 *
 * These are the only values in the repo that belong to more than one surface: the documentation
 * site's accent, the devtools panel's chrome, and the flower in the logo are all the same purple,
 * and before this module they were the same purple written out separately in each place — three
 * copies, one of them in a different case, with nothing to keep them equal.
 */
export const brand = {
  /** The primary purple. Panel edge, badge, active control, docs accent in light mode. */
  purple: "#7A4FBF",
  /** The purple that reads on a dark surface: active tab text, focus rings, docs accent in dark mode. */
  purpleLight: "#B18AE6",
  /** The deep purple. Only the logo uses it, as the stroke around the flower's centre. */
  purpleDeep: "#4E2F86",
  /** The gold at the flower's centre, and the panel's "look here" colour. */
  gold: "#E9B44C",
  /** Gold, one step up, for a hover state on a gold control. */
  goldHover: "#F3C463",
} as const;

export type Brand = typeof brand;

/**
 * The devtools panel's palette.
 *
 * ## Dark only, and that is a decision
 *
 * The panel is a tool laid over somebody else's application. Staying dark is what separates it from
 * the page underneath at a glance, whichever way that page is themed — the same reason the browser's
 * own devtools does not follow the site it is inspecting. So each token here is one value, not a
 * light/dark pair, and a light variant can be added later without renaming anything.
 *
 * ## Where these came from
 *
 * The panel's stylesheet held 66 distinct hex values across about 200 uses, with no names. Most were
 * not choices: `#2a2a2a` and `#2c2c2c` sat next to each other doing the same job, and seventeen
 * different purple-tinted darks were used once each. What survived is one token per ROLE.
 *
 * Two values were merged when no channel differed by more than 6/255, because nothing on screen can
 * show that. One merge is looser and is called out for it: `#888888` folded into `text-muted`
 * (`#8B8B93`), 11/255 apart on blue alone — the same grey, very slightly cooler. Everything further
 * apart than that kept its own token, however close the names look, because a difference you can see
 * is a decision somebody made.
 */
export const panel = {
  /* ── the marks ─────────────────────────────────────────────────────────────────────────── */
  brand: brand.purple,
  "brand-light": brand.purpleLight,
  gold: brand.gold,
  "gold-hover": brand.goldHover,

  /* ── neutral surfaces ──────────────────────────────────────────────────────────────────── */
  /** The panel itself. */
  surface: "#111111",
  /** Below the surface: a text input, the backdrop behind the value modal. Absorbs `#101010`. */
  "surface-sunken": "#0D0D0D",
  /** Above it: the tab strip, a state block, a row. Absorbs `#171717` and `#1C1C1C`. */
  "surface-raised": "#1A1A1A",
  /** A control at rest — a toolbar button. Absorbs `#2A2A2A` and `#2C2C2C`. */
  control: "#262626",
  /** The same control under the pointer. */
  "control-hover": "#303030",
  /** The ordinary dividing line. Absorbs `#383838`. */
  border: "#333333",
  /** A line that has to be seen against a raised surface — a scrollbar thumb, a button's edge. */
  "border-strong": "#3A3A3A",

  /* ── purple-tinted surfaces ────────────────────────────────────────────────────────────── */
  /** The breadcrumb bar, the darkest tinted surface. */
  "tint-deep": "#14121A",
  /** A hover inside the value tree. Absorbs `#191622`. */
  "tint-sunken": "#1D1A24",
  /** The common one: a toast, a crumb under the pointer, a chip, a progress bar's track.
   *  Absorbs `#2A2033`, `#262230`, `#2A2233` and `#2A2532` — four ways of writing this colour. */
  tint: "#241F30",
  /** A tinted control under the pointer. Absorbs `#322B3D`. */
  "tint-raised": "#322C3A",
  /** A tinted control at rest, in the value modal's toolbar. Absorbs `#3A2D47`. */
  "tint-control": "#383142",
  /** The edge of a tinted control. Absorbs `#4A4058`. */
  "tint-border": "#443A52",

  /* ── text ──────────────────────────────────────────────────────────────────────────────── */
  /** On the brand purple, and on anything that must not be missed. */
  "text-strong": "#FFFFFF",
  /** The panel's own body text. */
  "text-bright": "#EEEEEE",
  /** Inside a control: a button's label, a data pane. Absorbs `#D8D8D8`. */
  text: "#CCCCCC",
  /** Secondary: a note under a field, a null in the value tree, metadata. Absorbs `#888888`. */
  "text-muted": "#8B8B93",
  /** A key beside its value; a number that is context rather than content. */
  "text-dim": "#9A9AA2",
  /** A placeholder, a delete affordance that has not been reached for. */
  "text-faint": "#666666",
  /** An icon button at rest, waiting to be hovered. */
  "text-faintest": "#4A4A4A",
  /** The separator between breadcrumbs. */
  "text-separator": "#555555",
  /** Punctuation in the value tree — the commas nobody reads. Absorbs `#6A6472`. */
  "text-punct": "#6A6A72",

  /** Tinted text, four steps. Each names how loud it is, on a tinted surface. */
  "text-tint": "#9A8FB5",
  "text-tint-hover": "#B9AECD",
  "text-tint-bright": "#CFC6DD",
  "text-tint-brightest": "#E8E2F2",

  /* ── status ────────────────────────────────────────────────────────────────────────────── */
  /** A query that resolved, a form that validates. */
  ok: "#54C98A",
  /** State that just moved — the flash on an updated row, a live block's edge. */
  live: "#00FFAA",
  /** A hook's badge in the component tree, told apart from a component by colour. */
  hook: "#66AA33",
  /** A hook's NAME in the tree — the same green lifted, because it is text and not a filled badge. */
  "hook-text": "#88CC66",
  /** Something is wrong: the badge's burst, an outline, a destructive hover. */
  error: "#FF4444",
  /** The settled error — a badge that stays red, a recording button. */
  "error-deep": "#C0392B",
  /** Error text that has to stay readable on a dark surface. */
  "error-soft": "#FF8080",
  /** A query's error line. */
  "error-text": "#FF6B6B",
  /** The edge and the ground under an error control. */
  "error-border": "#5C3040",
  "error-surface": "#3A2230",
  /** In flight, or gone stale. */
  warn: "#FFCC00",
  busy: "#00AAFF",

  /* ── the value tree's syntax ───────────────────────────────────────────────────────────── */
  "syntax-key": "#9ECBFF",
  "syntax-string": "#7EE787",
  "syntax-number": "#79C0FF",
  "syntax-boolean": "#FFAB70",
  "syntax-null": "#8B8B93",
  "syntax-function": "#D2A8FF",
  "syntax-other": "#E3B341",
  "syntax-punct": "#6A6A72",

  /* ── type ──────────────────────────────────────────────────────────────────────────────── */
  /**
   * One monospace stack, where the stylesheet had four spellings of the same intent — `monospace`,
   * `ui-monospace, Menlo, monospace`, and one with `SFMono-Regular` in it. `ui-monospace` resolves
   * to the platform's own UI monospace and is what actually renders on a current browser; the rest
   * of the list is the fallback, and it should be the same list everywhere.
   */
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  /**
   * The platform's own interface font, and not a face of ours.
   *
   * `sans-serif` alone is the browser's default — Arial, or Liberation Sans — which is nobody's
   * choice and looks foreign next to the rest of the machine. `system-ui` is the font the operating
   * system draws its own windows in, so the panel looks like it belongs there.
   *
   * A face of our own was measured and rejected. `@font-face` does not register inside a shadow
   * root — neither in an inline `<style>` nor through `adoptedStyleSheets`, both fall back — so a
   * font shipped with the panel would have to be declared on the DOCUMENT, where its family name is
   * visible to the page. And the panel exists only in a development build, so a page that started
   * using that name would look right while you worked and different once you shipped. That is the
   * class of bug this tool is for finding, not for creating.
   */
  sans: "system-ui, sans-serif",
} as const;

export type PanelTokens = typeof panel;

/**
 * The documentation site's palette.
 *
 * Separate from the panel's, and that is not an oversight. The site is a page somebody reads and
 * follows their system's light or dark preference; the panel is a tool laid over another page and
 * stays dark. What the two genuinely share is the brand, which is why `accent` reads from `brand`
 * here rather than repeating `#7a4fbf` — the copy that had already drifted in case.
 *
 * `error` and `ok` are new as tokens and not new as colours: the site was already drawing an invalid
 * field and a passing check, in values written into the rules that used them and with no dark
 * counterpart, so on a dark page they were a deep red and a deep green against near-black. The light
 * values below are the ones already in use; the dark ones are the same hues lifted until they read.
 */
export const site = {
  light: {
    bg: "#FFFFFF",
    fg: "#1B1B1F",
    muted: "#6B6B76",
    line: "#E5E5EC",
    accent: brand.purple,
    "code-bg": "#F6F6F9",
    error: "#C0392B",
    ok: "#2D7D46",
    /** Paired with `ok` in the structural-sharing demo: a value rebuilt, against one kept. */
    fresh: "#A03070",
  },
  dark: {
    bg: "#111114",
    fg: "#E8E8ED",
    muted: "#9A9AA6",
    line: "#2A2A32",
    accent: brand.purpleLight,
    "code-bg": "#1A1A20",
    error: "#FF8080",
    ok: "#54C98A",
    fresh: "#E58FBC",
  },
} as const;

export type SiteTokens = typeof site;

/**
 * The documentation site's type.
 *
 * IBM Plex, one family in two roles — the same reasoning that picked one icon set rather than the
 * best icon from each. Plex was drawn for technical documentation and for code, which is the whole
 * of what this site is.
 *
 * **The panel does not get this, and that is not an oversight.** `@font-face` does not register
 * inside a shadow root — measured, both an inline `<style>` and `adoptedStyleSheets` fall back — so
 * a font shipped with the devtools would have to be declared on the document, where the page can
 * name it. And the panel exists only in a development build, so a page that started using that name
 * would look right while you worked and different once you shipped.
 *
 * A stack and not a single name: the face is asked for first, and what follows is what draws the
 * page in the moment before it arrives, and on any request that never gets it.
 */
export const siteFonts = {
  sans: '"IBM Plex Sans Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

/**
 * The faces themselves.
 *
 * Three files, and each one is here because something on the site needs it: the roman covers every
 * weight through its axis (566 `<strong>`s and the headings come out of one file), the italic is a
 * separate face because an axis cannot slant a letterform, and the mono is a single weight because
 * the highlighter emits neither bold nor italic code — checked, zero of each across all 74 pages.
 *
 * `swap` on all three: the page is prose, and prose that is invisible while a font loads is worse
 * than prose that changes face once.
 */
export const siteFaces = [
  {
    family: "IBM Plex Sans Variable",
    style: "normal",
    weight: "100 700",
    file: "plex-sans-var.woff2",
    format: "woff2-variations",
  },
  {
    family: "IBM Plex Sans Variable",
    style: "italic",
    weight: "100 700",
    file: "plex-sans-var-italic.woff2",
    format: "woff2-variations",
  },
  {
    family: "IBM Plex Mono",
    style: "normal",
    weight: "400",
    file: "plex-mono.woff2",
    format: "woff2",
  },
] as const;

/**
 * The bloom.
 *
 * Five petals at 72° and a gold centre. The geometry lived in four `.svg` files and once more inside
 * a template literal in the devtools panel, each with the brand colours written out again — so the
 * purple appeared in five places, and changing it meant remembering all five.
 *
 * The petals are a parameter because the panel's copy is white: it sits on the brand purple in the
 * header, where a purple flower would be invisible.
 */
export function bloom({
  petals = brand.purple,
  centre = brand.gold,
  ring = brand.purpleDeep,
}: {
  petals?: string;
  centre?: string;
  ring?: string | null;
} = {}): string {
  const petal = (rotation: number) =>
    `<ellipse cx="0" cy="-14" rx="8.6" ry="14"${rotation ? ` transform="rotate(${rotation})"` : ""}/>`;
  const flower = [0, 72, 144, 216, 288].map(petal).join("");
  const centreRing = ring === null ? "" : `<circle r="6.6" fill="none" stroke="${ring}" stroke-width="1.4"/>`;
  return `<g fill="${petals}">${flower}</g><circle r="6.6" fill="${centre}"/>${centreRing}`;
}

/** The page colours the mark is placed on, which are the site's rather than the panel's. */
export const logoGround = {
  /** The near-white behind the app icon and the social card — a purple-tinted white, not `#fff`. */
  paper: "#FBF8FF",
  /** The social card's heading and its subtitle. */
  heading: "#241E2E",
  subheading: "#6B6376",
} as const;

/**
 * The panel's icons.
 *
 * ## Why they are not glyphs any more
 *
 * They were Unicode characters — `⌖`, `◧`, `⬡`, `✎` — and a character is drawn by whatever font
 * the system happens to have. The same toolbar was a different toolbar on every machine, and on a
 * machine with no glyph for `⬡` it was an empty box. An inline SVG is the same eleven shapes
 * everywhere.
 *
 * ## Why the paths are copied in rather than depended on
 *
 * These are thirteen paths, about 3 kB. The package they come from carries nine thousand icons, and
 * a dependency on it — even a development one — would be nine thousand icons in the dependency graph
 * so that a panel can draw a pencil.
 *
 * From **Phosphor Icons** (regular weight), MIT, Copyright (c) 2023 Phosphor Icons.
 * https://phosphoricons.com — to change one, take the `d` of its `<path>` from
 * `@phosphor-icons/core/assets/regular/<name>.svg`.
 */
const ICON_PATHS = {
  /** pick a component from the page — phosphor `cursor-click` */
  pick: "M88,24V16a8,8,0,0,1,16,0v8a8,8,0,0,1-16,0ZM16,104h8a8,8,0,0,0,0-16H16a8,8,0,0,0,0,16ZM124.42,39.16a8,8,0,0,0,10.74-3.58l8-16a8,8,0,0,0-14.31-7.16l-8,16A8,8,0,0,0,124.42,39.16Zm-96,81.69-16,8a8,8,0,0,0,7.16,14.31l16-8a8,8,0,1,0-7.16-14.31ZM219.31,184a16,16,0,0,1,0,22.63l-12.68,12.68a16,16,0,0,1-22.63,0L132.7,168,115,214.09c0,.1-.08.21-.13.32a15.83,15.83,0,0,1-14.6,9.59l-.79,0a15.83,15.83,0,0,1-14.41-11L32.8,52.92A16,16,0,0,1,52.92,32.8L213,85.07a16,16,0,0,1,1.41,29.8l-.32.13L168,132.69ZM208,195.31,156.69,144h0a16,16,0,0,1,4.93-26l.32-.14,45.95-17.64L48,48l52.2,159.86,17.65-46c0-.11.08-.22.13-.33a16,16,0,0,1,11.69-9.34,16.72,16.72,0,0,1,3-.28,16,16,0,0,1,11.3,4.69L195.31,208Z",
  /** expand every row — phosphor `caret-line-down` */
  expand:
    "M42.34,77.66A8,8,0,0,1,53.66,66.34L128,140.69l74.34-74.35a8,8,0,0,1,11.32,11.32l-80,80a8,8,0,0,1-11.32,0ZM208,184H48a8,8,0,0,0,0,16H208a8,8,0,0,0,0-16Z",
  /** collapse every row — phosphor `caret-line-up` */
  collapse:
    "M213.66,197.66a8,8,0,0,1-11.32,0L128,123.31,53.66,197.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,197.66ZM48,80H208a8,8,0,0,0,0-16H48a8,8,0,0,0,0,16Z",
  /** show or hide state and props — phosphor `sidebar-simple` */
  values:
    "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM40,56H80V200H40ZM216,200H96V56H216V200Z",
  /** show or hide hooks — phosphor `hexagon` */
  hooks:
    "M223.68,66.15,135.68,18h0a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM216,175.82,128,224,40,175.82V80.18L128,32h0l88,48.17Z",
  /** close — phosphor `x` */
  close:
    "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z",
  /** focus this component — phosphor `crosshair-simple` */
  focus:
    "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm8,191.63V184a8,8,0,0,0-16,0v31.63A88.13,88.13,0,0,1,40.37,136H72a8,8,0,0,0,0-16H40.37A88.13,88.13,0,0,1,120,40.37V72a8,8,0,0,0,16,0V40.37A88.13,88.13,0,0,1,215.63,120H184a8,8,0,0,0,0,16h31.63A88.13,88.13,0,0,1,136,215.63Z",
  /** edit this value — phosphor `pencil-simple` */
  edit: "M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z",
  /** open the value in the full view — phosphor `arrows-out-simple` */
  expandValue:
    "M216,48V96a8,8,0,0,1-16,0V67.31l-50.34,50.35a8,8,0,0,1-11.32-11.32L188.69,56H160a8,8,0,0,1,0-16h48A8,8,0,0,1,216,48ZM106.34,138.34,56,188.69V160a8,8,0,0,0-16,0v48a8,8,0,0,0,8,8H96a8,8,0,0,0,0-16H67.31l50.35-50.34a8,8,0,0,0-11.32-11.32Z",
  /** start recording — phosphor `record` */
  record:
    "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm0-160a72,72,0,1,0,72,72A72.08,72.08,0,0,0,128,56Zm0,128a56,56,0,1,1,56-56A56.06,56.06,0,0,1,128,184Z",
  /** stop recording — phosphor `stop` */
  stop: "M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,160H56V56H200V200Z",
  /** a collapsed node in the value tree — phosphor `caret-right` */
  caretRight:
    "M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z",
  /** an expanded node in the value tree — phosphor `caret-down` */
  caretDown:
    "M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z",
} as const;

export type IconName = keyof typeof ICON_PATHS;

/**
 * One icon, as inline SVG.
 *
 * Sized in `em` so it follows whatever it sits beside — a toolbar label and a row's edit affordance
 * are different sizes, and an icon that ignored that would be wrong in one of them. `currentColor`
 * for the same reason: the icon is the text's colour, including on hover, with no second rule.
 *
 * `aria-hidden`, always: every one of these is inside a control that carries its own `title`, so
 * announcing the shape as well would say everything twice.
 */
export function icon(name: IconName, size = "1.05em"): string {
  return (
    `<svg class="rmd-icon" width="${size}" height="${size}" viewBox="0 0 256 256" ` +
    `fill="currentColor" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`
  );
}

/**
 * The same shape as a `url()`, for a CSS `mask` — the value tree's disclosure marker, which is a
 * `::before` and so has no element to put an `<svg>` in.
 *
 * A mask and not a `background-image`: a data URI would have to bake the fill in, and the marker is
 * two colours (one closed, one open) that both come from tokens. Masked, the colour is the
 * `background-color` and the tokens still decide it.
 */
export function iconMask(name: IconName): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">` + `<path d="${ICON_PATHS[name]}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
