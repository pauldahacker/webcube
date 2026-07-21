import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Multi-page build. Without this, `vite build` bundles only index.html and the
// editor is missing from dist/ (it works in `vite dev` because the dev server
// serves every HTML file). List every HTML entry point here.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        editor: fileURLToPath(new URL('./editor.html', import.meta.url)),
      },
    },
  },
});
