import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`        -> multi-file build in dist/ (GitHub Pages / sk8.io hosting)
// `npm run build:single` -> one self-contained dist-single/index.html (desktop shortcut / offline play)
// `npm run build:demo`   -> one self-contained dist-demo/demo.html (lightweight park + stand-in skater)
export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    outDir: mode === 'single' ? 'dist-single' : mode === 'demo' ? 'dist-demo' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: mode === 'demo' ? { input: 'demo.html' } : undefined,
  },
  plugins: mode === 'single' || mode === 'demo' ? [viteSingleFile()] : [],
}));
