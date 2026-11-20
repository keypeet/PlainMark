import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.PLAINMARK_API_URL || 'http://127.0.0.1:4985';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false
      }
    }
  },
  build: {
    target: 'chrome114',
    minify: 'esbuild',
    sourcemap: false
  },
  test: {
    environment: 'jsdom'
  }
});
