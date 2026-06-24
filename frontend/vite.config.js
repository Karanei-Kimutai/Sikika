import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy third-party dependencies into their own vendor chunks,
        // separate from app code and from each other. These rarely change
        // version-to-version, so isolating them keeps repeat-visit caching
        // effective even as app code (including the route-level chunks in
        // App.jsx) ships changes. Complements the React.lazy() route
        // splitting in App.jsx — that one shrinks the initial JS payload by
        // deferring page code; this one keeps the remaining vendor code from
        // being re-downloaded every time app code changes.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('gsap')) return 'vendor-gsap';
          if (id.includes('socket.io-client') || id.includes('engine.io-client')) return 'vendor-socket';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react';
          return 'vendor';
        }
      }
    }
  }
})
