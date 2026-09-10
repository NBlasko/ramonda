import { describe, expect, test } from "vitest";
import { namedSites, syntaxesIn } from "../compiler/references";
import { transform } from "../compiler/transform";

/**
 * A named site declared in ONE file and read in ANOTHER.
 *
 * A `@@property( … )` compiles to a generated name, and a block that reads it writes that name in as
 * TEXT — no hole, no custom property on the element, and a static atom shared with every other block
 * that reads the same token. That is what makes a theme cost nothing per element.
 *
 * **It only worked inside one file, and the cross-file case failed SILENTLY.** Measured before this:
 *
 *     import { accent } from "./theme";
 *     background: var({accent});
 *     -> background:var(var(--r-rfpVZr3es-0));
 *
 * `var(var(…))` computes to nothing in Chromium and the declaration is dropped, while the one beside
 * it is applied. `hole-as-a-variable-name` reports it now, so it fails loudly — but reporting a
 * theme module is not the same as supporting one.
 *
 * ## The three limits, and each is a decision rather than a shortcut
 *
 * - **Relative specifiers only.** `./theme`, `../tokens`. A package specifier needs a resolver, and
 *   the four consumers of this function would each have to bring the same one; the certificate is
 *   the vehicle for that later.
 * - **One hop.** A site in the imported file that itself reads a third file is not resolved, and the
 *   third file's own compile is where that is reported. Without the limit this is a module graph,
 *   and a module graph in a per-file transform is a cycle waiting to be found by somebody's build.
 * - **Reading is INJECTED.** The build reads the disk; the editor must read its own unsaved buffer.
 *   A shared answer that came from two different texts is the one thing this cannot afford, because
 *   the name is a hash of the text.
 */
describe("a named site imported from another module", () => {
  const theme = `export const accent = @@property( syntax: "<color>"; inherits: true; initial-value: #10b981; );\n`;
  const reader = (files: Record<string, string>) => (specifier: string, from: string) => {
    void from;
    return files[specifier];
  };

  test("a named import resolves to the same name the declaring file gives it", () => {
    const own = namedSites(theme);
    const there = namedSites(`import { accent } from "./theme";\nconst card = @@( color: var({accent}); );\n`, {
      filename: "/src/Card.tsx",
      read: reader({ "./theme": theme }),
    });

    expect(there.get("accent")).toBe(own.get("accent"));
    expect(there.get("accent")).toMatch(/^--r-/);
  });

  test("an alias resolves under the name the importing file uses", () => {
    const there = namedSites(`import { accent as brand } from "./theme";\nconst c = @@( color: var({brand}); );\n`, {
      filename: "/src/Card.tsx",
      read: reader({ "./theme": theme }),
    });

    expect(there.get("brand")).toBe(namedSites(theme).get("accent"));
    expect(there.has("accent")).toBe(false);
  });

  test("only what the import names is brought in", () => {
    const two = `${theme}export const gap = @@property( syntax: "<length>"; inherits: true; initial-value: 12px; );\n`;
    const there = namedSites(`import { accent } from "./theme";\n`, {
      filename: "/src/Card.tsx",
      read: reader({ "./theme": two }),
    });

    expect(there.has("accent")).toBe(true);
    expect(there.has("gap")).toBe(false);
  });

  test("a site declared HERE wins over one of the same name imported", () => {
    const here = `import { accent } from "./theme";\nexport const accent = @@property( syntax: "<length>"; inherits: false; initial-value: 1px; );\n`;
    const there = namedSites(here, { filename: "/src/Card.tsx", read: reader({ "./theme": theme }) });

    expect(there.get("accent")).not.toBe(namedSites(theme).get("accent"));
  });

  /**
   * The clause shapes people write, and one that resolved NOTHING.
   *
   * `import d, { accent } from "./theme"` was not matched at all, so the token degraded silently to
   * a hole. Loud in the end, through `hole-as-a-variable-name` — but it is a shape none of the three
   * documented limits mentions, and nothing about a default import makes the named ones unreadable.
   */
  test.each([
    ["a plain named import", 'import { accent } from "./theme";'],
    ["a default before the clause", 'import d, { accent } from "./theme";'],
    ["a type modifier inside it", 'import { type Tone, accent } from "./theme";'],
  ])("%s resolves the token", (_what, line) => {
    const there = namedSites(`${line}\n`, { filename: "/src/Card.tsx", read: reader({ "./theme": theme }) });

    expect(there.has("accent")).toBe(true);
  });

  test("and a renamed one is known by the name this file uses", () => {
    const there = namedSites(`import { accent as brand } from "./theme";\n`, {
      filename: "/src/Card.tsx",
      read: reader({ "./theme": theme }),
    });

    expect(there.has("brand")).toBe(true);
    // The generated name is the DECLARING module's, so renaming on import changes no variable.
    expect(there.get("brand")).toBe(namedSites(theme).get("accent"));
  });

  describe("what it must not resolve", () => {
    /**
     * A COMMENTED-OUT import, which the line anchor caught in one spelling and not the other.
     *
     * `// import …` never matched. A `/* … *\/` opened at column 0 did — so the token still
     * resolved, and a build that should have refused compiled. **Commenting an import out to see
     * whether it is needed is the ordinary way to find out**, and here it changed nothing except
     * that an error disappeared. The regex's own note claimed this direction "fails closed".
     */
    test.each([
      ["a line comment", '// import { accent } from "./theme";'],
      ["a block comment", '/*\nimport { accent } from "./theme";\n*/'],
      ["a block comment with the import indented", '/*\n  import { accent } from "./theme";\n*/'],
    ])("%s is not an import", (_what, text) => {
      const there = namedSites(`${text}\nconst c = @@( color: red; );\n`, {
        filename: "/src/Card.tsx",
        read: reader({ "./theme": theme }),
      });

      expect(there.has("accent")).toBe(false);
    });

    /** And a real import after a closed comment is still read — the blanking ends where it ends. */
    test("one written after a comment is read", () => {
      const there = namedSites(`/* a note */\nimport { accent } from "./theme";\n`, {
        filename: "/src/Card.tsx",
        read: reader({ "./theme": theme }),
      });

      expect(there.has("accent")).toBe(true);
    });

    test("a package specifier, which needs a resolver this does not have", () => {
      const there = namedSites(`import { accent } from "@acme/theme";\n`, {
        filename: "/src/Card.tsx",
        read: reader({ "@acme/theme": theme }),
      });

      expect(there.has("accent")).toBe(false);
    });

    test("a module the reader cannot produce", () => {
      const there = namedSites(`import { accent } from "./missing";\n`, {
        filename: "/src/Card.tsx",
        read: reader({}),
      });

      expect(there.has("accent")).toBe(false);
    });

    /** One hop. The third file's own compile is where a reference it cannot resolve is reported. */
    test("a site the imported file itself imported", () => {
      const middle = `import { accent } from "./deep";\n`;
      const there = namedSites(`import { accent } from "./theme";\n`, {
        filename: "/src/Card.tsx",
        read: reader({ "./theme": middle, "./deep": theme }),
      });

      expect(there.has("accent")).toBe(false);
    });

    test("a default import, which names no site", () => {
      const there = namedSites(`import theme from "./theme";\n`, {
        filename: "/src/Card.tsx",
        read: reader({ "./theme": theme }),
      });

      expect(there.has("theme")).toBe(false);
    });

    test("with no reader at all, which is every caller that has not opted in", () => {
      expect(namedSites(`import { accent } from "./theme";\n`).has("accent")).toBe(false);
    });

    test("and a file with no import is not read at all", () => {
      let asked = 0;
      namedSites(`const c = @@( color: red; );\n`, {
        filename: "/src/Card.tsx",
        read: () => {
          asked++;
          return undefined;
        },
      });

      expect(asked).toBe(0);
    });
  });
});

/**
 * The rule of an imported token travels with whoever READS it.
 *
 * A reference resolves to text, so after the transform the imported binding is referenced by nothing
 * the emitted code holds — the import goes unused, a bundler drops the module, and the `@property`
 * it declared never reaches the stylesheet. **Measured through a real Vite build before this
 * existed: the reading classes were right and the registration was simply absent.**
 *
 * Emitting it from the reader costs nothing to do twice. The name is a hash of the declaring
 * module's own text, so every reader emits the same rule under the same name and the sheet keeps
 * one — which is the same property that makes an atom written in fifty files one rule.
 */
/**
 * THE SYNTAX MAP AND THE REFERENCE MAP KEY THE SAME SITE, and they used to disagree.
 *
 * `namedSites` reads a block with `resolve`, so a `{token}` inside it becomes the TEXT it compiles
 * to; `syntaxesIn` read with no `resolve` at all, so the same block normalised differently and
 * hashed to a different name. Measured, on a `@@property` whose own body names another token —
 * which is the ordinary shape of a theme:
 *
 *     namedSites   [["base","--r-k8u6ISIlk"],["other","--r-Uo2yQGE1g"]]
 *     syntaxesIn   [["--r-k8u6ISIlk","<color>"],["--r-7DeqAp7g7","<color>"]]
 *
 * `--r-Uo2yQGE1g` was in no syntax map, so the transform never checked what `other` may hold and
 * `{other}: 12px` on a `<color>` property COMPILED — the exact failure `value-and-registered-syntax`
 * exists to prevent, and it shipped silently for every theme that references itself.
 */
describe("the two maps a named site appears in", () => {
  const THEME =
    'const base  = @@property( syntax: "<color>"; inherits: true;  initial-value: red; );\n' +
    'const other = @@property( syntax: "<color>"; inherits: false; initial-value: var({base}); );\n';

  test("every name in one is a name in the other", () => {
    const names = [...namedSites(THEME).values()];
    const syntaxes = [...syntaxesIn(THEME).keys()];

    expect(names.sort()).toEqual(syntaxes.sort());
  });

  test.each([
    ["one whose body names nothing", "{base}"],
    ["one whose body names another token", "{other}"],
  ])("a wrong value is refused for %s", (_what, token) => {
    const source = `${THEME}const a = <div css=@@( ${token}: 12px; )>x</div>;\n`;

    expect(() => transform(source, { filename: "C.tsx" })).toThrow(/registered as .<color>./);
  });
});

/**
 * WHAT NAMES A NAMED SITE, and the one of the three that is not named by its body.
 *
 * Two `@@keyframes` with the same steps are the same animation, and two `@@font-face` with the same
 * `src` are the same face — identical ones anywhere in a build collapse to one rule, which is the
 * property the whole design rests on.
 *
 * A `@@property` is not like them. A keyframes is a VALUE; a registered custom property is a place to
 * keep one, and two registrations that read the same are still two variables — the way
 * `let x = 0; let y = 0;` is two variables.
 *
 * Measured before this: two tokens declared side by side with the same `syntax`, `inherits` and
 * `initial-value` — the ordinary shape of a palette — got ONE name, and the emitted literal came out
 * with a duplicate key, so the first was discarded by the second and every read of it got the other's
 * value. Nothing warned: the sheet's collision assertion cannot fire, because the two `@property`
 * rules genuinely are identical.
 */
describe("two named sites with identical bodies", () => {
  const twice = (at: string, body: string) =>
    namedSites(`export const one = @@${at}( ${body} );\nexport const two = @@${at}( ${body} );\n`);

  test("two `@@property` tokens are two variables", () => {
    const names = twice("property", 'syntax: "<color>"; inherits: true; initial-value: #10b981;');

    expect(names.get("one")).not.toBe(names.get("two"));
  });

  test("but two `@@keyframes` are one animation, which is right", () => {
    const names = twice("keyframes", "from { opacity: 0; }");

    expect(names.get("one")).toBe(names.get("two"));
  });

  test("and the emitted literal has no duplicate key", () => {
    const source =
      'export const accent  = @@property( syntax: "<color>"; inherits: true; initial-value: #10b981; );\n' +
      'export const surface = @@property( syntax: "<color>"; inherits: true; initial-value: #10b981; );\n' +
      "const card = <div css=@@( {accent}: red; {surface}: blue; )>x</div>;\n";
    const line =
      transform(source, { filename: "C.tsx" })
        ?.code.split("\n")
        .find((one) => one.includes("_merge({")) ?? "";
    const keys = [...line.matchAll(/"(--r-[^"]+)":/g)].map((one) => one[1]);

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  /** The DECLARING module names it, so importing under another name changes no variable. */
  test("a token is the same variable in every file that reads it", () => {
    const theme = 'export const accent = @@property( syntax: "<color>"; inherits: true; initial-value: red; );\n';
    const there = namedSites(`import { accent as brand } from "./theme";\n`, {
      filename: "/src/Card.tsx",
      read: (specifier: string) => (specifier === "./theme" ? theme : undefined),
    });

    expect(there.get("brand")).toBe(namedSites(theme).get("accent"));
  });
});

describe("the rule an imported token declared", () => {
  const theme = `export const accent = @@property( syntax: "<color>"; inherits: true; initial-value: #10b981; );\n`;
  const read = (specifier: string) => (specifier === "./theme" ? theme : undefined);

  const emit = (source: string) => transform(source, { filename: "/src/Card.tsx", read });

  test("is emitted by the file that reads it", () => {
    const out = emit(`import { accent } from "./theme";\nconst c = @@( color: var({accent}); );\n`);
    const rules = (out?.blocks ?? []).filter((one) => one.at === "property");

    expect(rules).toHaveLength(1);
    expect(rules[0].css).toContain('syntax:"<color>"');
    expect(rules[0].className).toMatch(/^--r-/);
  });

  test("under the same name the declaring module gives it", () => {
    const there = emit(`import { accent } from "./theme";\nconst c = @@( color: var({accent}); );\n`);
    const own = transform(`${theme}const c = @@( color: var({accent}); );\n`, { filename: "/src/theme.tsx" });

    const nameIn = (result: typeof there) => (result?.blocks ?? []).find((one) => one.at === "property")?.className;
    expect(nameIn(there)).toBe(nameIn(own));
  });

  test("and the reading declaration is a STATIC atom, with no custom property on the element", () => {
    const out = emit(`import { accent } from "./theme";\nconst c = @@( color: var({accent}); );\n`);
    const atom = (out?.blocks ?? []).find((one) => one.at === undefined);

    expect(atom?.properties).toEqual([]);
    expect(out?.code).not.toContain("var(var(");
  });

  test("once, however many declarations read it", () => {
    const out = emit(
      `import { accent } from "./theme";\nconst c = @@( color: var({accent}); border-color: var({accent}); );\n`,
    );

    expect((out?.blocks ?? []).filter((one) => one.at === "property")).toHaveLength(1);
  });

  /**
   * Imported and not read: the rule is emitted anyway, and that is the safe direction rather than an
   * oversight. Knowing that no declaration reads it would mean scanning every block before deciding,
   * and the two failures are not comparable — a registration nobody reads costs a few dozen bytes in
   * the sheet, while a missing one silently takes away interpolation and the `initial-value`
   * fallback for everyone who does read it.
   */
  test("and once for an import nothing reads, which is the cheaper way to be wrong", () => {
    const out = transform(`import { accent } from "./theme";\nconst c = @@( color: red; );\n`, {
      filename: "/src/Card.tsx",
      read,
    });

    expect((out?.blocks ?? []).filter((one) => one.at === "property")).toHaveLength(1);
  });
});
