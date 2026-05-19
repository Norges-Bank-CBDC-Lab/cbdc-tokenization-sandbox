import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Modern browsers only — see services/nb-ui/DEVELOPMENT.md "Browser support".
// No polyfills, no legacy transforms.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
  },
});
