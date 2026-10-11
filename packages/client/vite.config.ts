import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 127.0.0.1 (not localhost): the server listens on 127.0.0.1 and localhost may resolve to ::1 first.
const backend = 'http://127.0.0.1:9000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/socket.io': { target: backend, ws: true },
    },
  },
});
