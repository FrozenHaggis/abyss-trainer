import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone app — no backend. `base: './'` keeps the build openable from disk
// and deployable to a subpath (e.g. GitHub Pages) without reconfiguration.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
})
