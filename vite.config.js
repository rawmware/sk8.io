import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets allow the same build on a domain root or a GitHub Pages subpath.
  base: './',
  build: {
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three/ }] } },
    },
  },
});
