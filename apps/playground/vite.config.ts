import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
  },
  esbuild: {
    jsxFactory: "__ramondaH",
    jsxInject: `import { h as __ramondaH } from '@ramonda/core'`,
    target: "es2022",
  },
});
