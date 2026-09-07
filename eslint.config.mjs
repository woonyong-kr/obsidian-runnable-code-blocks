import eslint from "@eslint/js";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...obsidianmd.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
      "@typescript-eslint/require-await": "off"
    }
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@microsoft/sdl/no-inner-html": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "obsidianmd/no-global-this": "off",
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/prefer-instanceof": "off"
    }
  },
  {
    files: ["src/ui.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off"
    }
  },
  {
    files: ["site/browser-dom-adapter.ts"],
    rules: {
      // The static host does not provide Obsidian's prototype helpers.
      "obsidianmd/prefer-create-el": "off"
    }
  },
  {
    files: ["local-runner/**/*.ts"],
    rules: {
      "no-restricted-globals": "off",
      "obsidianmd/no-nodejs-modules": "off",
      "obsidianmd/prefer-window-timers": "off"
    }
  },
  { ignores: ["main.js", "node_modules", "coverage", "dist-site", "scripts/*.mjs"] }
);
