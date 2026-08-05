import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@ramonda/core",
    target: "es2022",
  },
});
