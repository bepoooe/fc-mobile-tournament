import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('firebase/app')) return 'firebase-app'
            if (id.includes('firebase/firestore')) return 'firebase-firestore'
            if (
              id.includes('react-dom') ||
              id.includes('/react/') ||
              id.includes('scheduler')
            ) {
              return 'react'
            }

            return 'vendor'
          }
        },
      },
    },
  },
  server: {
    port: 3000,
  },
})
