import { defineConfig, kind } from "@ramonda/css/config";

/**
 * What a style block may say in this project — read by your editor, by `npm run typecheck` and by
 * the build, so a value outside it is an error before anything runs.
 *
 * It starts strict on purpose: every colour and every length but a percentage comes from a token
 * below, so a page cannot drift off the scale one hand-typed value at a time. Loosen it where you
 * mean to — see https://ramonda.dev/style-blocks/config.
 */
export default defineConfig({
  tokens: {
    // `light-dark(light, dark)` follows the reader's system setting: the page declares `color-scheme`.
    $color: kind("color", {
      page: "light-dark(#fbf8ff, #14101a)",
      text: "light-dark(#241a2e, #ece6f3)",
      muted: "light-dark(#6b6376, #a79fb3)",
      accent: "light-dark(#7a4fbf, #b18ae6)",
      onAccent: "#ffffff",
      surface: "light-dark(#ffffff, #1e1826)",
      line: "light-dark(#ece3f5, #2e2739)",
      code: "light-dark(#efe8f8, #2a2236)",
    }),
    $space: kind("length", { xs: "2px", s: "8px", m: "12px", l: "24px", xl: "40px" }),
    $size: kind("length", { line: "1px", focus: "3px", card: "480px", column: "672px", screen: "100vh" }),
    $radius: kind("length", { s: "5px", m: "10px", l: "16px" }),
    $font: kind("length", { s: "14px", l: "36px" }),
  },
  // A duration is written in `ms` and an angle in `deg`, one spelling each.
  units: { time: ["ms"], angle: ["deg"] },
  properties: {
    // Colours and lengths only from the tokens above. `0` and a percentage may still be written.
    "<color>": { hardcoded: false },
    "<length>": { hardcoded: false },
    "<percentage>": { hardcoded: true },
  },
  // No custom property made up on the spot: a shared value is a token.
  unknownCustomProperties: false,
  // A block styles its own element. A child gets a block of its own.
  styleOtherElements: false,
});
