import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages root site (astro-view.github.io) -> base '/'
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          maplibre: ['maplibre-gl'],
          astronomy: ['astronomy-engine'],
        },
      },
    },
  },
});
