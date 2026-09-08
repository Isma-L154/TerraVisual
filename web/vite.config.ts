// vitest/config re-exports Vite's defineConfig with the test options typed.
// Importing from 'vite' instead makes the `test` block a type error.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: {
    // Classic, not module: the analyzer worker loads Go's wasm_exec.js shim
    // with importScripts, which module workers do not have.
    format: 'iife',
  },
  build: {
    // The output is a plain static directory. ADR-0001 removed the server, so
    // there is nothing here that needs a runtime.
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    // The deployment Worker lives outside web/ but is TypeScript we own, so it
    // is tested by the same runner rather than by a second one to configure.
    include: ['src/**/*.test.{ts,tsx}', '../deploy/**/*.test.ts'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
