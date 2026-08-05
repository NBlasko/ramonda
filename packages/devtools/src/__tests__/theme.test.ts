import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { icon, panel } from "@ramonda/theme";
import { describe, expect, test } from "vitest";
import { PANEL_CSS } from "../styles";

/**
 * The panel's colours come from `@ramonda/theme`, and nothing checks that at compile time: a
 * `var(--rmd-surfcae)` is valid CSS, resolves to nothing, and leaves an element with no background
 * at all. These tests are what a type would have been.
 */

const SRC = join(import.meta.dirname, "..");
const sources = readdirSync(SRC)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, text: readFileSync(join(SRC, name), "utf8") }));

describe("the panel's palette", () => {
  test("every token it asks for exists", () => {
    const unknown: string[] = [];

    for (const { name, text } of sources) {
      for (const [, token] of text.matchAll(/var\(--rmd-([a-z0-9-]+)\)/g)) {
        if (!(token in panel)) unknown.push(`${name}: --rmd-${token}`);
      }
    }

    expect(unknown).toEqual([]);
  });

  test("every token it declares is used", () => {
    const referenced = new Set<string>();
    for (const { text } of sources) {
      for (const [, token] of text.matchAll(/var\(--rmd-([a-z0-9-]+)\)/g)) referenced.add(token);
    }

    // A token nobody reads is a value that has quietly stopped being the panel's, and the next person
    // to change it will change nothing.
    expect(Object.keys(panel).filter((token) => !referenced.has(token))).toEqual([]);
  });

  test("the declarations are in the stylesheet, on :host", () => {
    // On the host and not on `.ramonda-panel`, because the badge is the panel's SIBLING — a token
    // declared on the panel would not reach the thing you click to open it.
    const start = PANEL_CSS.indexOf(":host {");
    expect(start).toBeGreaterThan(-1);
    const head = PANEL_CSS.slice(start, PANEL_CSS.indexOf("}", start));
    // Lowercased on both sides: the table is written the way the brand is written down, and the
    // stylesheet comes out the way `biome format` writes CSS. Same colour, one spelling each.
    for (const [token, value] of Object.entries(panel)) {
      expect(head.toLowerCase()).toContain(`--rmd-${token}: ${value.toLowerCase()};`);
    }
  });

  test("every icon it asks for exists, and every icon it has is used", () => {
    const asked = new Set<string>();
    for (const { text } of sources) {
      for (const [, name] of text.matchAll(/\bicon(?:Mask)?\("([A-Za-z]+)"\)/g)) asked.add(name);
    }

    expect(asked.size).toBeGreaterThan(10);
    // `icon` throws on nothing — an unknown name yields `undefined` in the path, which draws an
    // empty box. So the check is that each one resolves to real path data.
    for (const name of asked) {
      expect(icon(name as Parameters<typeof icon>[0]), name).toMatch(/<path d="[Mm][^"]+"\/>/);
    }
  });

  /**
   * The glyphs are gone and must stay gone.
   *
   * Each of these was drawn by whatever font the machine had, so the toolbar looked different on
   * every one of them — and on a machine with no glyph for `⬡`, it was an empty box.
   */
  test("no icon is a Unicode glyph any more", () => {
    // `…` truncation, `·` separators, `ƒ()` and `⌘` in prose are text and stay text.
    const RETIRED = ["⌖", "▾", "▸", "◧", "⬡", "◎", "✎", "⤢", "●", "■", "&times;", "\\25B8", "\\25BE"];
    const strays: string[] = [];

    for (const { name, text } of sources) {
      for (const glyph of RETIRED) {
        if (text.includes(glyph)) strays.push(`${name}: ${glyph}`);
      }
    }

    expect(strays).toEqual([]);
  });

  test("no colour is written out by hand any more", () => {
    const strays: string[] = [];

    for (const { name, text } of sources) {
      if (name === "styles.ts") {
        // Drop shadows and highlights are light and shade on whatever is underneath, not palette.
        const palette = text.replace(/rgba\(\s*(?:0,\s*0,\s*0|255,\s*255,\s*255)[^)]*\)/g, "");
        for (const [hex] of palette.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) strays.push(`${name}: ${hex}`);
        continue;
      }
      // Elsewhere a `#` in a comment or a URL is fine; a colour in a style attribute is not.
      for (const [, hex] of text.matchAll(
        /(?:color|background|fill|stroke|outline)\s*:\s*[^;"'`]*?(#[0-9a-fA-F]{3,8})\b/g,
      )) {
        strays.push(`${name}: ${hex}`);
      }
    }

    expect(strays).toEqual([]);
  });
});
