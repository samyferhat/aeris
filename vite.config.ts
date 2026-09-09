import { defineConfig } from 'vite';
import { screenshotPlugin } from './tools/vite-screenshot-plugin';
export default defineConfig({
  plugins: [screenshotPlugin()],
  server: { port: 5173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  assetsInclude: ['**/*.hdr', '**/*.glb'],
});
