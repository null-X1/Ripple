import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const isVercel = !!process.env.VERCEL;
const port = Number(process.env.PORT ?? 3000);
const basePath = process.env.BASE_PATH ?? "/";

const replitPlugins =
  !isVercel && process.env.NODE_ENV !== "production"
    ? await Promise.all([
        import("@replit/vite-plugin-runtime-error-modal").then((m) =>
          m.default()
        ),
        process.env.REPL_ID !== undefined
          ? import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({ root: path.resolve(import.meta.dirname, "..") })
            )
          : null,
        import("@replit/vite-plugin-dev-banner").then((m) => m.devBanner()),
      ]).then((plugins) => plugins.filter(Boolean))
    : [];

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss(), ...replitPlugins],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "attached_assets"
      ),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: { strict: true },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
