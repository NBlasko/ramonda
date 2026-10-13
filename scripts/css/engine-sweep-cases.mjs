/**
 * The cases `check-engine-sweep.mjs` asks the engines and the checker about: a valid BASE for every
 * place a block holds CSS text, and every token of it damaged the ways a person damages one.
 *
 * Every base is valid in Chromium, Firefox and WebKit and silent in the checker — the gate asserts
 * both, so a base that stops being one fails loudly rather than skewing the count.
 */

const DECLARATIONS = [
  "width: 10px",
  "color: red",
  "border-left: 4px solid currentColor",
  "transform: rotate(45deg)",
  "grid-template-columns: repeat(3, 1fr)",
  "background-image: linear-gradient(red, blue)",
  "margin: 0 auto",
  "font: 12px/1.5 sans-serif",
  "transition: opacity 150ms ease-in",
  "box-shadow: 0 1px 2px rgb(0 0 0 / 0.2)",
  "width: calc(100% - 2rem)",
  "display: flex",
  "z-index: 2",
  "opacity: 0.5",
  "line-height: 1.5",
  "aspect-ratio: 16 / 9",
  "inset: 0",
  "font-weight: 600",
  'content: "x"',
  "cursor: pointer",
  "filter: blur(2px)",
  "clip-path: circle(50%)",
  "color: rgb(1 2 3)",
  "color: #abc",
  "gap: 1rem 2rem",
  "flex: 1 1 0%",
  "border-radius: 4px / 8px",
  "outline: 2px dashed currentColor",
  "padding: 1em 2ch",
  "width: min(100%, 40rem)",
  "translate: 10px 20px",
  "color: color-mix(in srgb, red 40%, blue)",
  "animation-duration: 2s",
  "text-decoration: underline wavy red",
  "transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1)",
  "grid-area: 1 / 2 / 3 / 4",
  "font-family: system-ui, sans-serif",
  "background-position: center top 10px",
  "position: absolute",
  "overflow: hidden auto",
  "scale: 1.5",
  "rotate: 10deg",
  "width: 50vw",
  "height: 100dvh",
  // Added 2026-10-13: the properties and functions the first sweep never put in front of a damage.
  "grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr))",
  'grid-template-areas: "a b" "c d"',
  "grid-column: 1 / span 2",
  "place-items: center start",
  "justify-content: space-between",
  "align-items: baseline",
  "flex-flow: row wrap",
  "transform: translate(10px, 20px) scale(1.2) rotate(5deg)",
  "transform: matrix(1, 0, 0, 1, 10, 20)",
  "transform-origin: left top",
  "filter: drop-shadow(0 1px 2px black) brightness(120%)",
  "backdrop-filter: blur(4px) saturate(1.5)",
  "background-image: radial-gradient(circle at center, red 0%, blue 100%)",
  "background-image: conic-gradient(from 90deg, red, blue)",
  "background-image: repeating-linear-gradient(45deg, red 0 10px, blue 10px 20px)",
  "background-size: cover",
  "background: url(a.png) no-repeat center / contain, white",
  "box-shadow: inset 0 0 0 1px red, 0 2px 4px rgba(0, 0, 0, 0.3)",
  "text-shadow: 1px 1px 2px black",
  "animation: spin 1s linear infinite",
  "transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1) 0.1s",
  "transition-timing-function: steps(4, jump-end)",
  "color: hsl(120deg 50% 50% / 0.5)",
  "color: oklch(70% 0.1 200)",
  "color: lab(50% 40 59.5)",
  "color: color(display-p3 1 0.5 0)",
  "color: light-dark(white, black)",
  "border-color: transparent currentColor",
  "border: thin double rgb(0 128 0)",
  "outline-offset: -2px",
  "clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  "clip-path: inset(10px round 4px)",
  "clip-path: ellipse(50% 40% at center)",
  "font-variant-numeric: tabular-nums slashed-zero",
  'font-feature-settings: "liga" 1, "kern" 0',
  "font-size: clamp(1rem, 2vw + 0.5rem, 3rem)",
  "letter-spacing: 0.05em",
  "text-decoration: underline dotted 2px",
  "list-style: square inside",
  "counter-increment: section 2",
  'content: counter(section) ". "',
  "object-fit: cover",
  "object-position: 50% 25%",
  "scroll-snap-type: x mandatory",
  "scroll-margin-top: 4rem",
  "will-change: transform, opacity",
  "cursor: url(hand.cur), pointer",
  "pointer-events: none",
  "user-select: none",
  "writing-mode: vertical-rl",
  "mix-blend-mode: multiply",
  "opacity: 50%",
  "max-width: fit-content",
  "width: calc(100% - var(--gap, 1rem))",
  "margin-inline: auto",
  "padding-block: 1rem 2rem",
  "inset-inline-start: 0",
  "border-radius: 50% / 25%",
  "aspect-ratio: auto 4 / 3",
  "accent-color: rebeccapurple",
  "caret-color: auto",
  "tab-size: 4",
  "hyphens: auto",
  "overflow-wrap: anywhere",
  "text-overflow: ellipsis",
  "white-space: pre-wrap",
  "vertical-align: middle",
  "z-index: -1",
  "order: -1",
];

const MEDIA = [
  "(min-width: 40rem)",
  "(max-width: 600px)",
  "(prefers-color-scheme: dark)",
  "(hover: hover)",
  "(orientation: landscape)",
  "(min-resolution: 2dppx)",
  "(width >= 40rem)",
  "(400px <= width <= 70rem)",
  "(min-aspect-ratio: 16/9)",
  "screen and (min-width: 40rem)",
  "(prefers-reduced-motion: reduce)",
  "print",
  "(pointer: coarse)",
  "(min-width: 40rem) and (max-width: 60rem)",
  "(color-gamut: p3)",
  "(any-hover: hover) and (any-pointer: fine)",
  "(prefers-contrast: more)",
  "(forced-colors: active)",
  "(display-mode: standalone)",
  "(max-height: 500px) and (orientation: landscape)",
  "not all and (monochrome)",
  "only screen and (min-resolution: 192dpi)",
  "(30em <= width < 60em)",
];

const CONTAINER = [
  "(min-width: 40rem)",
  "(width > 30em)",
  "(orientation: portrait)",
  "(inline-size >= 20rem)",
  "card (min-width: 20rem)",
  "(min-height: 10rem) and (orientation: landscape)",
  "(aspect-ratio > 1 / 2)",
  "not (width < 10rem)",
  "(width > 10rem) or (height > 10rem)",
];

const SUPPORTS = [
  "(display: grid)",
  "(gap: 1rem)",
  "selector(:has(a))",
  "(color: rgb(1 2 3))",
  "(display: grid) and (gap: 1rem)",
  "not (display: grid)",
  "(display: grid) or (display: flex)",
  "font-tech(color-COLRv1)",
  "font-format(woff2)",
  "(transform: rotate(5deg))",
  "(background: linear-gradient(red, blue))",
  "selector(:focus-visible)",
];

const SELECTORS = [
  "&:hover",
  "&:focus-visible",
  "&::before",
  "&:not(.a)",
  "&:nth-child(2n+1)",
  "&:is(.a, .b)",
  "& > .a",
  '&[data-x="1"]',
  "&:has(> img)",
  "&::placeholder",
  "&:first-child",
  "&:where(.a)",
  "& + .a",
  "&.a",
  "&:checked",
  "&::after",
  "&:disabled",
  "&:nth-of-type(odd)",
  "&:nth-last-child(-n+3)",
  "&:nth-child(2n of .item)",
  '&[href^="https"]',
  '&[data-state="open" i]',
  "&:lang(sr)",
  "&:dir(rtl)",
  "&::part(label)",
  "&::selection",
  "&::marker",
  "&:focus-within",
  "&:not(:first-child):not(:last-child)",
  "& ~ .a",
  "& .a > .b",
  "&:has(+ .a)",
  "&:is(:hover, :focus-visible)",
  "&::first-letter",
  "&:placeholder-shown",
  "&:user-invalid",
];

/**
 * Each token a letter longer, a letter shorter, with two letters swapped, and — for a number — its
 * unit dropped or replaced by one no engine has. A bracket or a separator is removed outright.
 */
function damaged(text) {
  const out = new Set();
  for (const found of text.matchAll(/[A-Za-z#%][\w-]*|\d+(?:\.\d+)?[a-z%]*|[()[\],/:>+]/g)) {
    const [token] = found;
    const put = (instead) => out.add(text.slice(0, found.index) + instead + text.slice(found.index + token.length));
    if (/^[()[\],/:>+]$/.test(token)) {
      put("");
      continue;
    }
    put(`${token}x`);
    if (token.length > 2) put(token.slice(0, -1));
    if (token.length > 3) put(token[0] + token[2] + token[1] + token.slice(3));
    if (/^\d/.test(token)) {
      put(token.replace(/[a-z%]+$/, ""));
      put(`${token.replace(/[a-z%]+$/, "")}pz`);
    }
  }
  out.delete(text);
  return [...out];
}

/** Every case: `{ site, base, text, isBase }`, the base first in each family. */
export function sweepCases() {
  const cases = [];
  const add = (site, base) => {
    cases.push({ site, base, text: base, isBase: true });
    for (const text of damaged(base)) cases.push({ site, base, text, isBase: false });
  };
  for (const one of DECLARATIONS) add("decl", one);
  for (const one of MEDIA) add("media", one);
  for (const one of CONTAINER) add("container", one);
  for (const one of SUPPORTS) add("supports", one);
  for (const one of SELECTORS) add("selector", one);
  return cases;
}

/** How a case is written inside a block. */
export function inABlock({ site, text }) {
  if (site === "decl") return `${text};`;
  if (site === "selector") return `${text} { color: red; }`;
  return `@${site} ${text} { color: red; }`;
}

/** The key a case is listed under in the baseline. */
export const keyOf = ({ site, text }) => `${site} | ${text}`;
