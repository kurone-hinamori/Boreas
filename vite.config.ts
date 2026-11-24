import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Euros・Notos の開発サーバー(1420)と同時に動かせるよう、別のポートにする
  server: { port: 1430, strictPort: true },
  // 依存の事前読み込みはアプリの画面だけを見る(手元の実験用の HTML は対象外)
  optimizeDeps: { entries: ["index.html"] },
  build: { target: "es2022" },
});
