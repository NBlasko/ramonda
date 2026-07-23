import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
  },
  esbuild: {
    jsxFactory: "h",
    jsxInject: `import { h } from '@ramonda/core'`,
    target: "es2022",
  },
});
