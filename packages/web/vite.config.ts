import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxy = {
  target: "http://127.0.0.1:3000",
  changeOrigin: true,
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/health": apiProxy,
      "/nodes": apiProxy,
      "/workflows": apiProxy,
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: true,
  },
});
