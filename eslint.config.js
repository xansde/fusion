// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "**/*.svelte",
      ".dependency-cruiser.cjs",
      "**/svelte.config.js",
    ],
  },
  {
    // Type-aware rules for source files covered by package tsconfigs.
    // Test files and vitest/vite configs are handled separately below.
    files: [
      "packages/shared/src/*.ts",
      "packages/system-api/src/*.ts",
      "packages/server/src/*.ts",
      "packages/client/src/**/*.ts",
      "systems/stub/src/*.ts",
    ],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },
  {
    // Test files and config files — lint without type-checking.
    // (Most package tsconfigs exclude __tests__ from build output; the server
    // tsconfig was also updated to do so.)
    files: [
      "**/__tests__/**/*.ts",
      "**/vitest.config.ts",
      "**/vitest.workspace.ts",
      "**/vite.config.ts",
    ],
    extends: [...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },
);
