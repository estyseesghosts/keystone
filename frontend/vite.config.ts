import { defineConfig, loadEnv } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Same Keystone frontend, selectable backend:
  //   npm run dev -- --mode misskey   -> frontend/.env.misskey
  //   npm run dev -- --mode sharkey   -> frontend/.env.sharkey
  //   npm run dev                     -> Pinetree default below
  // Restart Vite when switching targets: the proxy target is read by the
  // dev server, not exposed to application code (except the VITE_* labels).
  const target = (env.KEYSTONE_BACKEND_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');

  return {
    plugins: [devtools(), solidPlugin()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/files': { target, changeOrigin: true },
        '/proxy': { target, changeOrigin: true },
        '/streaming': { target, changeOrigin: true, ws: true },
      },
    },
    build: {
      target: 'esnext',
    },
  };
});
