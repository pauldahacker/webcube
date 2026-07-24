import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Only index.html is bundled into dist/. The editor is a dev-only tool: it still
// works under `vite dev` (the dev server serves every HTML file), it's just kept
// out of the published build we ship to CrazyGames.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
});
