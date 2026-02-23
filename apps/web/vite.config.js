import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://api:3001',
        changeOrigin: true,
      },
      '/s': {
        target: 'http://api:3001',
        changeOrigin: true,
      },
      '/d': {
        target: 'http://api:3001',
        changeOrigin: true,
      },
    },
  },
})
