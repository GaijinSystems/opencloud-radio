/**
 * Builds the demo. `build.sh` copies this folder into a copy of the app's
 * source/ (as demo/) and runs vite there, so the app's own code and
 * dependencies are the ones built; only OpenCloud's web package is swapped for
 * the demo's stand-ins.
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
/** GitHub Pages runs Jekyll over the branch, and Jekyll leaves out names that start with `_` or `.`. */
const publishable = (name: string) => name.replace(/^[_.]+/, '')

export default defineConfig({
  root: here('.'),
  base: './',
  plugins: [vue()],
  resolve: {
    alias: { '@opencloud-eu/web-pkg': here('./web-pkg.ts') }
  },
  build: {
    outDir: process.env.DEMO_OUT ?? here('../demo-dist'),
    emptyOutDir: false, // build.sh clears the old build itself, keeping what the branch keeps
    rollupOptions: {
      output: {
        sanitizeFileName: (name) => publishable(name.replace(/[\0?*]+/g, '_').replace(/[^\w.-]/g, '_')),
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
})
