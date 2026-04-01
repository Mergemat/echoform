import path from "node:path";
import babel from "@rolldown/plugin-babel";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? "hidden" : false,
  },
  plugins: [
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
    sentryVitePlugin({
      org: "base-hn",
      project: "4511141666816080",
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
      "/api": {
        target: "http://localhost:3001",
      },
    },
  },
});
