// @ts-check

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://echoform.app",
  vite: {
    // Astro is still typed against Vite 7 while the Tailwind plugin resolves Vite 8 types.
    // The plugin works at runtime; this only narrows the config surface for astro check.
    // @ts-expect-error Workspace Vite plugin types do not align with Astro's bundled Vite types yet.
    plugins: [tailwindcss()],
  },
});
