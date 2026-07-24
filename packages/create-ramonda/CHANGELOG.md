# create-ramonda

## 0.0.2

### Patch Changes

- Fix the CLI doing nothing when run via `npm create ramonda` / `npx create-ramonda`. The "invoked as CLI" guard compared `process.argv[1]` (the `node_modules/.bin` symlink npm runs the bin through) against `import.meta.url` (the real file), so they never matched and `main()` never ran. Compare resolved real paths instead.
