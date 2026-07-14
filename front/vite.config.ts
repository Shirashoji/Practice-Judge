import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],

  // 開発モードでは/staticをviteのserverがproxyする。
  // 本番モードではexpressのサーバスクリプトで同じことをやる。
  // コンテナ内から動かす場合はBACKEND_INTERNAL_URLでapiコンテナを指す。
  server: {
      proxy: {
          "/static": {
              target: process.env.BACKEND_INTERNAL_URL || "http://localhost:8181/",
              changeOrigin: true
          }
      }
  }
});
