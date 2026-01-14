import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/appkit-entry.js'),
      name: 'ReownAppKit',
      fileName: 'appkit-bundle',
      formats: ['iife']
    },
    outDir: '../public/javascripts',
    emptyOutDir: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        entryFileNames: 'appkit-bundle.min.js',
        inlineDynamicImports: true
      }
    }
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  }
})
