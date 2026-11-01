/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

const TRANSFORMERS_VERSION: string = JSON.parse(readFileSync(new URL('./node_modules/@huggingface/transformers/package.json', import.meta.url), 'utf8')).version

/**
 * onnxruntime-web references its .wasm files with `new URL(..., import.meta.url)`, so Vite copies them into the
 * build (36 MB). Both voices load the runtime from the CDN instead (Kokoro via transformers.js, Piper pointed at the
 * same file), so those copies are never fetched: drop them from the output.
 */
function dropUnusedOrtWasm(): Plugin {
  return {
    name: 'lumen-drop-unused-ort-wasm',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const name of Object.keys(bundle)) if (/(^|\/)ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name]
    },
  }
}

/** Pages served WITHOUT cross-origin isolation (Google sign-in + Picker need window.opener / Google iframes). */
const NOT_ISOLATED = ['/google.html']

/**
 * Cross-origin isolation (COOP same-origin + COEP credentialless) for `vite dev` and `vite preview`,
 * so onnxruntime-web can use WASM threads. Mirrors the headers in vercel.json.
 */
function crossOriginIsolation(): Plugin {
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '/').split(/[?#]/)[0]
    // LUMEN_NO_COI=1 serves without isolation (to benchmark the single-threaded path)
    if (!process.env.LUMEN_NO_COI && !NOT_ISOLATED.includes(path)) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
    }
    next()
  }
  return {
    name: 'lumen-cross-origin-isolation',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  }
}

export default defineConfig({
  define: { __TRANSFORMERS_VERSION__: JSON.stringify(TRANSFORMERS_VERSION) },
  resolve: {
    // Piper's library imports the WASM-only onnxruntime build; use the same (WebGPU+WASM) build that Kokoro uses so
    // both voices load one shared runtime file.
    alias: [{ find: /^onnxruntime-web\/wasm$/, replacement: 'onnxruntime-web' }],
  },
  plugins: [
    crossOriginIsolation(),
    dropUnusedOrtWasm(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Lumen — Read Aloud',
        short_name: 'Lumen',
        description: 'Listen to your EPUB and PDF books with a natural on-device voice.',
        theme_color: '#2F54EB',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        file_handlers: [
          {
            action: '/',
            accept: { 'application/epub+zip': ['.epub'], 'application/pdf': ['.pdf'] },
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,ico}'],
        // the sign-in page must always come from the network with its own (non-isolated) headers
        globIgnores: ['google.html'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/google\.html/],
        runtimeCaching: [
          {
            // onnxruntime wasm (~21 MB) is too big to precache; cache it on first use
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'wasm', expiration: { maxEntries: 6 } },
          },
          {
            // onnxruntime-web wasm files used by kokoro-js
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net',
            handler: 'CacheFirst',
            options: {
              cacheName: 'ort-runtime',
              expiration: { maxEntries: 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['kokoro-js'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { main: 'index.html', google: 'google.html' } },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
})
