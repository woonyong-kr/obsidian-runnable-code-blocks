import { defineConfig } from "vitest/config";
import { reactRuntimeVitePlugin } from "./scripts/react-runtime-plugin.mjs";

export default defineConfig({
  plugins: [reactRuntimeVitePlugin()],
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
      exclude: ["site/main.ts"],
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
