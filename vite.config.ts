import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Keep the boss models out of the build.
 *
 * Vite copies everything in `public/` into `dist/` verbatim, and `public/models/`
 * is about 110MB of Blizzard's creature art that this project downloads at the
 * developer's own risk and never republishes — see ATTRIBUTION.md. On CI the
 * point is moot, because the models are gitignored and the runner has never seen
 * them; on a laptop it is not, and `npm run build` was quietly assembling a
 * publishable directory full of them. Anybody deploying that folder by hand
 * would have shipped the lot without deciding to.
 *
 * Deleting after the copy rather than preventing it: Vite offers no filter on
 * the public-directory copy, and a `closeBundle` hook is the last thing to run,
 * so nothing downstream can observe the directory in between.
 *
 * The dev server is untouched. It serves `public/` directly and never consults
 * this, which is what lets the barrel work locally while the build stays clean.
 */
function excludeBossModels(): Plugin {
  return {
    name: 'exclude-boss-models',
    apply: 'build',
    closeBundle: async () => {
      await rm(resolve(__dirname, 'dist/models'), { recursive: true, force: true })
    },
  }
}

// Standalone app — no backend. `base: './'` keeps the build openable from disk
// and deployable to a subpath (e.g. GitHub Pages) without reconfiguration.
export default defineConfig({
  plugins: [react(), excludeBossModels()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
})
