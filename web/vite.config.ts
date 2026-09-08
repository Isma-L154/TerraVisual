// vitest/config re-exports Vite's defineConfig with the test options typed.
// Importing from 'vite' instead makes the `test` block a type error.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // The output is a plain static directory. ADR-0001 removed the server, so
    // there is nothing here that needs a runtime.
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
