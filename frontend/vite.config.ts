import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    watch: {
      usePolling: true,
      interval: 500,
    },
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_API || 'http://localhost:3001',
        changeOrigin: true,
        xfwd: true,
      },
      '/ws': {
        target: process.env.VITE_PROXY_WS || 'ws://localhost:3001',
        ws: true,
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
})
