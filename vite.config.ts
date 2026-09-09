import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  assetsInclude: ['**/*.hdr', '**/*.glb'],
});
