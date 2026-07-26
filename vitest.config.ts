import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
      // The package's "module" field points at src/index.js, which is not
      // published (only dist/ ships). Bundlers that prefer "module" over
      // "main" resolve to a nonexistent file, so pin it to the built entry.
      "circular-natal-horoscope-js": resolve(
        __dirname,
        "node_modules/circular-natal-horoscope-js/dist/index.js",
      ),
    },
  },
});
