import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/client",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@assistant-ui")) return "assistant-ui";
          if (id.includes("@phosphor-icons")) return "icons";
          if (id.includes("node_modules/react")) return "react";
        },
      },
    },
  },
  plugins: [react()],
});
