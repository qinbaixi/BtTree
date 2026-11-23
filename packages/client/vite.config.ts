import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 127.0.0.1 (not localhost): the server listens on 127.0.0.1 and localhost may resolve to ::1 first.
const backend = 'http://127.0.0.1:9000';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('d3-')) {
              return 'd3';
            }
            if (id.includes('socket.io-client') || id.includes('engine.io-client')) {
              return 'socket';
            }
            if (
              id.includes('react-dom') ||
              id.includes('react-router') ||
              /[\\/]react[\\/]/.test(id)
            ) {
              return 'react';
            }
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/socket.io': { target: backend, ws: true },
    },
  },
});
