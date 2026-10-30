import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  root: 'src',
  publicDir: '../public',
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:3001',
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: mode === 'cloudflare' ? '../dist-cloudflare' : '../dist',
    emptyOutDir: true
  }
}));
