import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Node 22+ ships an experimental native `localStorage` global (enabled by
    // default as of Node 25, see `--experimental-webstorage`). Without a
    // `--localstorage-file`, that native global is an inert stub (no
    // getItem/setItem) and it shadows the Storage implementation that
    // happy-dom/jsdom would otherwise install on `globalThis`. Disabling the
    // flag for test worker processes lets the DOM environment provide a
    // working localStorage instead.
    execArgv: ['--no-experimental-webstorage'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'vitest.setup.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
