import { defineConfig } from "vitest/config";
import { reactRuntimeVitePlugin } from "./scripts/react-runtime-plugin.mjs";

import { previewWorkerVitePlugin } from "./scripts/preview-worker-plugin.mjs";

export default defineConfig({
  plugins: [reactRuntimeVitePlugin(), previewWorkerVitePlugin()],
  resolve: {
    alias: {
      obsidian: new URL("./tests/obsidian-runtime.ts", import.meta.url).pathname
    }
  },
  test: {
    exclude: ["tests/e2e/**", "node_modules/**", "dist-site/**"],
    environment: "happy-dom",
    setupFiles: ["./tests/setup-dom.ts"],
    coverage: {
      // The iframe entry is bundled as text and exercised by real-browser E2E; Node cannot instrument that execution.
      exclude: ["site/main.ts", "src/preview-worker/frame.mts", "src/preview-worker/canvas.mts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 70,
        functions: 75,
        lines: 80,
        statements: 80
      }
    }
  }
});
