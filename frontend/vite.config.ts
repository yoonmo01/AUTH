import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // hwp.js imports 'fs' at the module level; the browser Viewer only needs
      // a Uint8Array so we stub the module out entirely.
      fs: resolve(__dirname, 'src/empty-fs.ts'),
    },
  },
  // Relative asset paths so the packaged Electron build can load index.html
  // over file://. The dev server (below) is unaffected.
  base: './',
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
