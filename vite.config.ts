import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// 빌드 산출물은 HTML 한 파일.
// 정적 호스팅에 그대로 올라가고, 파일을 내려받아 더블클릭해도 열린다.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  build: {
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
