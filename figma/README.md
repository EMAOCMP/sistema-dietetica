# Mockups para Figma — Dietética Vishal

Set de pantallas de la app, en SVG vectorial (1440×900) con el design system real
(dark theme `#09090B`, brand indigo `#6366F1`, font Plus Jakarta Sans, sidebar 240px,
header 64px). Cada archivo es un frame completo listo para importar y editar en Figma.

## Archivos

| Archivo | Pantalla | Contenido |
|---|---|---|
| `01-login.svg` | Login | Card central, logo, campos email/password, CTA admin |
| `02-dashboard.svg` | Panel Principal | KPIs, tendencia 14 días, métodos de pago, top productos, stock crítico |
| `03-pos.svg` | Venta Rápida (POS) | Buscador, grilla de productos, carrito, cobro |
| `04-productos.svg` | Productos / Stock | Tabla de productos, filtros, badges de stock |
| `05-historial.svg` | Pedidos & Historial | KPIs del filtro, filtros, tabla con fila expandida (trazabilidad + reenvío WhatsApp), paginación |
| `06-usuarios.svg` | Usuarios y Actividad | Tabla de usuarios/roles, guía de permisos, modal de actividad |
| `07-configuracion.svg` | Configuración | Datos del negocio, fiscal (IVA/PV/margen), respaldo CSV, ubicaciones de stock |

Cada SVG tiene `*.png` al lado: previsualización renderizada a 1440×900 (no se sube a Figma).

## Importar a Figma

1. Abrir Figma (app de escritorio o navegador) → tu archivo de proyecto.
2. **Arrastrar el `.svg` desde el explorador directamente sobre el canvas.**
   - Figma lo importa como **grupo de capas editables** (texto = texto real, formas = shapes).
   - Alternativa: `File → Place image…` (`Ctrl+Shift+K`) y elegir el SVG.
3. Repetir con cada SVG. Quedan superpuestos: seleccionar y acomodar en fila
   (ej. seleccionar los 7 → align: "Tidy up").
4. Renombrar cada grupo raíz al nombre de la pantalla (`Login`, `Dashboard`, `POS`, …)
   y marcarlo como frame si se desea (`Ctrl+G` ya viene agrupado por archivo).

### Si el SVG importa "plano" (imagen bitmap)
- Opción A: usar la app de escritorio de Figma (mejor soporte de SVG).
- Opción B: abrir el SVG en un navegador → copiar el SVG desde las DevTools
  (`document.querySelector('svg').outerHTML`) → pegar en Figma (`Ctrl+V`).
- Verificar que el SVG tenga XML válido antes de importar (se validó con PowerShell:
  `XmlDocument.Load(...)` → sin errores en los 7 archivos; nodos por pantalla: 51 a 331).

## Estructura de capas (común a todas las pantallas)

```
svg
├── defs          → gradientes (brandGrad, avatarGrad, …)
├── Sidebar       → logo, nav items, badge stock, Configuración
├── Header        → search ⌘K, notificaciones, tema, avatar admin
└── Content       → título + subtítulo + componentes de la pantalla
```

Cada pantalla tiene el item de sidebar activo resaltado (rect indigo + texto `#C7D2FE`):

- `02` → Panel Principal · `03` → Venta Rápida · `04` → Productos / Stock
- `05` → Pedidos & Historial · `06` → Usuarios y Actividad · `07` → Configuración

## Tokens de diseño (para crear estilos en Figma)

| Token | Valor | Uso |
|---|---|---|
| `bg-canvas` | `#09090B` | fondo app |
| `bg-surface` | `#18181B` | cards, header |
| `bg-subtle` | `#0C0C0F` | sidebar, inputs, filas internas |
| `border` | `#27272A` / `#3F3F46` | bordes card / input |
| `brand` | `#6366F1` → `#4338CA` | gradiente primario, activo de nav |
| `text-primary` | `#F4F4F5` | títulos, valores |
| `text-secondary` | `#A1A1AA` | labels, nav inactivo |
| `text-muted` | `#71717A` / `#52525B` | subtipos, headers de tabla |
| `success` | `#10B981` / `#34D399` | OK, ganancia, CTA guardar |
| `warning` | `#F59E0B` / `#FBBF24` | stock bajo, respaldo |
| `danger` | `#EF4444` / `#F87171` | anular, stock 0 |
| `info` | `#3B82F6` / `#93C5FD` | ARCA, tarjeta, supervisor |

Radios: inputs/buttons 9–13px · cards 16px · modales 24px.
Sidebar 240px · header 64px · padding de contenido 24px.

## Regenerar PNGs

```powershell
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$dir  = "C:\Users\swami\Desktop\Dietetica\Dietetica-Supabase\figma"
foreach ($f in '01-login','02-dashboard','03-pos','04-productos','05-historial','06-usuarios','07-configuracion') {
  & $edge --headless --disable-gpu --screenshot="$dir\$f.png" --window-size=1440,900 "file:///$dir/$f.svg"
}
```

## Notas

- Los SVGs son mockups fielés a la UI real (mismos textos, columnas y flujos de
  `src/components/*View.tsx`), con datos de ejemplo.
- `05` muestra la fila expandida con ítems, ganancia estimada y bloque de
  reenvío por WhatsApp (tal como `HistoryView.tsx`).
- `06` incluye el modal de actividad de usuario (`UsersView.tsx`).
- `07` refleja `SettingsView.tsx`: datos del negocio, IVA/PV/margen, respaldo CSV y ubicaciones.
