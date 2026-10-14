import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'

// HTTPS dev:
//  - default: HTTP (localhost / LAN / Tailscale sin fricción).
//  - `npm run dev:https` → cert self-signed (aceptar 1 vez por dispositivo).
//  - Cert de Tailscale (sin advertencias): generar con
//      tailscale cert "<maquina>.<tailnet>.ts.net"
//    y correr con DV_SSL_KEY/DV_SSL_CERT apuntando a los .key/.crt.
//    Ej. PowerShell: $env:DV_SSL_KEY="C:\tailscale\maquina.key"; $env:DV_SSL_CERT="C:\tailscale\maquina.crt"; npm run dev
const useHttps = process.env.DV_HTTPS === '1'
const sslKeyPath = process.env.DV_SSL_KEY || ''
const sslCertPath = process.env.DV_SSL_CERT || ''
const useCustomCert = !!(sslKeyPath && sslCertPath && fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath))
if ((process.env.DV_SSL_KEY || process.env.DV_SSL_CERT) && !useCustomCert) {
  console.warn('[vite] DV_SSL_KEY/DV_SSL_CERT inválidos o inexistentes, sigo sin cert custom.')
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    ...(useCustomCert ? [] : useHttps ? [basicSsl()] : []),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.svg', 'icon-512.svg'],
      manifest: {
        name: 'Dietética Vishal',
        short_name: 'Dietética Vishal',
        description: 'Sistema de gestión de stock y ventas',
        lang: 'es',
        theme_color: '#FF6B00',
        background_color: '#161616',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://frhnuxgxdtfxpifadkgl.supabase.co',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              networkTimeoutSeconds: 10
            }
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-cache', expiration: { maxEntries: 50 } }
          }
        ]
      }
    })
  ],
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    ...(useCustomCert
      ? { https: { key: fs.readFileSync(sslKeyPath), cert: fs.readFileSync(sslCertPath) } }
      : {}),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Solo estas van a vendor explícito; el resto usa chunking por defecto
            // (así las deps de dynamic imports como jspdf no caen en la carga inicial)
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) return 'vendor';
            if (id.includes('@supabase')) return 'supabase';
            if (id.includes('lucide-react') || id.includes('@phosphor-icons')) return 'icons';
            if (id.includes('html5-qrcode') || id.includes('bwip-js')) return 'charts';
            if (id.includes('date-fns') || id.includes('zod')) return 'utils';
            return undefined;
          }
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
})
