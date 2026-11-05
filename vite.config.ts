import { defineConfig, type Plugin } from 'vite'
import { fileURLToPath } from 'node:url'

const foliate = fileURLToPath(new URL('./src/foliate-js', import.meta.url))

// Turn only opens EPUB and builds the book itself (see src/lib/epub.ts), so
// foliate-js's other format loaders and its zip.js are never reached.
// Stub them out so they don't ship in the bundle.
const UNUSED = /^\.\/(pdf|mobi|fb2|comic-book|vendor\/zip|vendor\/fflate)\.js$/
const stubUnusedFormats = (): Plugin => ({
  name: 'turn:stub-unused-formats',
  enforce: 'pre',
  resolveId(source, importer) {
    if (importer?.replaceAll('\\', '/').includes('/foliate-js/') && UNUSED.test(source))
      return '\0turn-stub:' + source
  },
  load(id) {
    if (id.startsWith('\0turn-stub:')) return 'export {}'
  },
})

export default defineConfig({
  clearScreen: false,
  plugins: [stubUnusedFormats()],
  resolve: { alias: { 'foliate-js': foliate } },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'chrome120',
    outDir: 'dist',
    emptyOutDir: true,
  },
})
