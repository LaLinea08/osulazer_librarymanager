import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: {
      rollupOptions: {
        input: resolve("src/main/index.ts"),
        output: { format: "es" },
      },
    },
  },
  preload: {
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: {
      rollupOptions: {
        input: resolve("src/preload/index.ts"),
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [react()],
  },
});
