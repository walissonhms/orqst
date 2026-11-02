import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.ORQST_PORT ?? '4317'}` },
      '/ws': { target: `ws://127.0.0.1:${process.env.ORQST_PORT ?? '4317'}`, ws: true },
    },
  },
});
