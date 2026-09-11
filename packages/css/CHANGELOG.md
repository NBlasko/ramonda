# @ramonda/css

## 0.1.0

### Minor Changes

- 691c632: `@ramonda/css`: style blocks, published

  A style block is `@@( … )` written beside the markup, and what goes inside it is CSS. Before the
  build, every static declaration becomes a class that already exists in a stylesheet, and every
  `{ … }` hole becomes one CSS custom property the element carries — so the runtime sets values, never
  rules.

  ```tsx
  <div css=@@(
    display: flex;
    gap: 8px;
    border-left: 4px solid {this.accent};
    &:hover {
      border-left-color: #00b37e;
    }
  )>…</div>
  ```

  **Everything a tool needs to read the syntax ships here.** The compiler, plugins for Vite and
  esbuild, a language-service plugin for the editor, a Prettier plugin, and `ramonda-css` — a formatter
  and linter wrapper for biome and oxlint, which have no plugin surface for a syntax they cannot parse.

  **Nothing in the entry imports the framework**, at any depth: a page that loads a compiled block
  pulls in a class name and a map of custom properties.

  The editor's colours are a separate install, because a grammar costs nothing and a compiler does:
  **Ramonda CSS** on the Visual Studio Marketplace.
