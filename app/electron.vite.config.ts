import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { developmentContentSecurityPolicyPlugin } from "./build/content-security-policy.mjs";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/electron/main.ts"),
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: resolve(__dirname, "src/electron/preload.ts"),
        output: {
          entryFileNames: "index.cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    root: ".",
    build: {
      rollupOptions: {
        input: resolve(__dirname, "index.html"),
      },
    },
    plugins: [developmentContentSecurityPolicyPlugin(), react()],
  },
});
