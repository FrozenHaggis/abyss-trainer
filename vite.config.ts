import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone app — no backend. `base: './'` keeps the build openable from disk
// and deployable to a subpath (e.g. GitHub Pages) without reconfiguration.
//
// `public/models/` is copied into the build along with everything else in
// `public/`, and that is now deliberate: the boss models are committed so the
// deployed picker can show the barrel rather than its card fallback. A build
// step used to delete them again, back when they were never meant to ship.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
})
