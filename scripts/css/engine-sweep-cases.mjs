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
];

const CONTAINER = [
  "(min-width: 40rem)",
  "(width > 30em)",
  "(orientation: portrait)",
  "(inline-size >= 20rem)",
  "card (min-width: 20rem)",
];

const SUPPORTS = [
  "(display: grid)",
  "(gap: 1rem)",
  "selector(:has(a))",
  "(color: rgb(1 2 3))",
  "(display: grid) and (gap: 1rem)",
  "not (display: grid)",
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
