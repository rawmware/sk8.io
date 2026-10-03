import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`        -> multi-file build in dist/ (GitHub Pages / sk8.io hosting)
// `npm run build:single` -> one self-contained dist-single/index.html (desktop shortcut / offline play)
export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
}));
