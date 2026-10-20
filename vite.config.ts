import { defineConfig } from "vite";
export default defineConfig({
  base: "/",
  server: {
    proxy: { "/api": process.env.VITE_API_PROXY ?? "http://127.0.0.1:3001" },
  },
});
