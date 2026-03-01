import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// "base" doit correspondre exactement au nom de ton repo GitHub
// ex: repo "parlay-edge" → base: "/parlay-edge/"
export default defineConfig({
  plugins: [react()],
  base: "/parlay-edge/",
});
