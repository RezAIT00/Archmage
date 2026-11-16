import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // hot reload is off on purpose: frame-by-frame captures must not be interrupted by file edits
  server: { host: '127.0.0.1', hmr: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
