import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Recall frontend (Vite + React)
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true },
});
