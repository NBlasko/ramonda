import { defineConfig } from "vite";
import { ramonda } from "@ramonda/build/vite";

export default defineConfig({
  server: {
    port: 3000,
  },
  // The plugin an app uses. It sets the JSX runtime, and lowers the decorators on Vite 8, where
  // Oxc cannot and an `esbuild` block here is only translated into Oxc's settings.
  plugins: [ramonda()],
});
