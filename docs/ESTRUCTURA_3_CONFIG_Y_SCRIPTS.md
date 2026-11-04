# Estructura del Proyecto - Parte 3: Configuración, Scripts y Prototipos

Este documento detalla la estructura de configuración del entorno, scripts de operación, pruebas y prototipos visuales (Figma).

## 1. Configuración y Entorno Raíz
- **`package.json`**: Dependencias de producción y desarrollo (Vite, React 19, Tailwind v4, `@supabase/supabase-js`, Vitest, Playwright, lucide-react, etc.) y scripts de ejecución.
- **`vite.config.ts`**: Configuración de Vite, plugins PWA (VitePWA) y optimización de compilación.
- **`vitest.config.ts` & `playwright.config.ts`**: Configuración de pruebas unitarias (Vitest) y pruebas end-to-end / smoke (Playwright).
- **`tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json`**: Configuración estricta de TypeScript.
- **`.oxlintrc.json`**: Reglas de linter (Oxlint).
- **`.env.local`**: Variables de entorno locales (URL y Anon Key de Supabase).
- **`README.md`**: Documentación principal del repositorio.
- **`CONECTIVIDAD.md`**: Guía de acceso online seguro mediante Tailscale, configuración de firewall y auto-inicio en Windows.
- **`DESIGN-SYSTEM.md`**: Guía de diseño visual y estético de la aplicación.

## 2. Scripts de Automatización y Operación (`scripts/`)
- **`iniciar-dev.bat`**: Script robusto (CRLF + ASCII) para verificar el puerto 3000 y levantar el servidor de desarrollo de forma desacoplada, registrando la salida en `dev-server.log`.
- **`detener-dev.bat`**: Script para cerrar limpiamente el servidor de desarrollo en ejecución.
- **`dev-server.log`**: Archivo de registro del servidor de desarrollo.

## 3. Prototipos Visuales y Documentación de Diseño (`figma/` y `docs/`)
- **`figma/`**: Mockups y prototipos vectoriales (SVG) y rasterizados (PNG) de las vistas principales (01 a 07: Login, Dashboard, POS, Productos, Historial, Usuarios, Configuración) acompañados de su `README.md`.
- **`docs/`**: Documentación técnica complementaria del proyecto (presentación, diagramas del escáner, etc.).

## 4. Recursos Públicos y Activos (`public/`)
- **Iconos y Logotipos**: Archivos SVG y JPG (`logo-512.jpg`, `icon-192.svg`, `favicon.svg`, manifest PWA).
