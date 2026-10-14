# Escáner Dietética Vishal — Estructura completa y diagnóstico

> Documento vivo. Refleja lo implementado hasta la fecha + diagnóstico de fallas y fixes.
> Propuesta futura (no implementada): `docs/ESCANER-PRODUCTOS-V2.md`.

---

## 1. Arquitectura: Scanner ≠ Producto / Scanner ≠ Stock / Scanner ≠ Venta

El Scanner Core **solo emite lecturas**. Nunca importa `supabase`. El flujo padre resuelve.

```ts
interface ScanResult {
  rawCode: string;
  normalizedCode: string;
  format: BarcodeFormat;      // ean_13 | ean_8 | upc_a | upc_e | code_128 | code_39 | qr | unknown
  source: 'camera' | 'hardware' | 'manual';
  scannedAt: number;
}

type BarcodeResolution =
  | { status: 'found'; barcode: string; product: ProductLite; matchedVia: 'primary' | 'alias' }
  | { status: 'not_found'; barcode: string }
  | { status: 'invalid'; barcode: string; reason: string };
```

Contrato: `captura ── onDetected/code ──► padre: resolve → found/not_found/invalid ──► panel`.

Reglas:
- **ScanGuard**: mismo código + < 800 ms = ignorar (solo anti-ráfaga de cámara).
- En POS el doble escaneo deliberado suma cantidad (no duplica línea).
- Stock **nunca** se toca al escanear; solo en transacción (`add_stock`, `confirm_stock_receipt`, `create_sale`).

---

## 2. Árbol de archivos (`src/features/scanner/`)

```
src/features/scanner/
├── types/scanner.types.ts            # ScanResult, BarcodeResolution, ScannerStatus/Error/State, ProductLite
├── services/barcodeNormalizer.ts     # normalizeCode / detectFormat / plausibleCode (checksum EAN/UPC)
├── services/barcodeResolver.ts       # resolveBarcode() — única puerta a DB (alias → primario → not_found/invalid)
├── services/scaleParser.ts           # isScaleCode / parseScaleCode (balanza 20|PLU|peso|check) + __tests__
├── hooks/useScanGuard.ts             # clase ScanGuard + hook instancia estable
├── hooks/useHardwareScanner.ts       # lector USB/BT como teclado: código + ENTER global (ignora inputs)
├── engines/CameraScannerEngine.ts    # wrapper Html5Qrcode: listCameras/start/stop/torch/capabilities + retry sin HD
├── ScannerProvider.tsx               # contexto global: estado, cámaras, torch, emit→resolver, resolution
└── components/ScannerModal.tsx        # UI única foto-primero (ver §5)
```

### 2.1 Normalización (idéntica en TS y Postgres)

- trim → UPC-A 12 díg = `'0' + código` → quitar no-alnum → uppercase.
- SQL: `normalize_barcode()` + trigger `trg_barcode_normalized` + índice único
  `ux_product_barcodes_normalized` + columna `active`.

### 2.2 Resolver (`resolveBarcode`)

1. `normalize` → vacío = `invalid`.
2. `plausibleCode` (checksum) → falla = `invalid` con motivo.
3. `product_barcodes` por `barcode_normalized` + `active` → `found` (`matchedVia: 'alias'`).
4. Fallback `products.barcode` → `found` (`matchedVia: 'primary'`).
5. Si no: `not_found`. Si la tabla no existe aún: try/catch → sigue al fallback.

---

## 3. Integraciones por vista

| Vista | Resolver (`setOnDetected`) | Modal | Extra |
|---|---|---|---|
| **POS** (`POSView.tsx`) | local → online; **balanza primero** (PLU + peso en nombre) | `ScannerModal immediate` + "Agregar al carrito" | F8: hardware sin modal auto-agrega (efecto sobre `resolution`); F9: `resolveScale` → `addToCart(peso)` sin ScaleModal |
| **Productos** (`ProductsView.tsx`) | local → online | `ScannerModal` + "Usar" / "Crear producto" | moves con autor (ver §7) |
| **Ingreso** (`StockIntakeView.tsx`) | local → online | `ScannerModal` + agrega línea al lote | confirma vía `confirm_stock_receipt()` |
| **App** (`App.tsx`) | `<ScannerProvider>` envuelve todo lo autenticado | — | hardware listener global activo |

Archivo viejo eliminado: `src/components/BarcodeScannerModal.tsx` (reemplazado).

---

## 4. Base de datos (escáner)

- `supabase/mvp_stock_model.sql` — EJECUTADO OK (locations 1, inventory 4, movements 27, barcodes 3).
  - `locations`, `inventory` (NUMERIC 12,3 por kg), `inventory_movements` (solo-append),
    `product_barcodes` v2, `normalize_barcode()`, triggers sync, RPCs `add_stock()` / `adjust_stock()`, RLS.
- `supabase/ventas_ingresos_model.sql` — EJECUTADO OK (0/0/0, tablas nuevas).
  - `stock_receipts` + `stock_receipt_items`, `payments`, `confirm_stock_receipt()`, `create_sale()`.
- `supabase/roles_permisos.sql` v2 — EJECUTADO OK (53 policies).
  - `user_role()` helper; vendedor: todo menos borrar/ubicaciones/usuarios
    (productos solo `active→active`, ingresos sin cancelar, ventas sin anular).
- `supabase/diagnostico_esquema.sql` — script de diagnóstico reutilizable (tablas, columnas, funciones, RLS).

---

## 5. ScannerModal (UI foto-primero)

Orden: **foto hero** (`scanFile`, sin stream/permisos) → preview + reintentar → **manual** →
paneles `found/not_found/invalid` → sección "Avanzado" colapsada con **cámara en vivo**
(selector, continuo, linterna, motor Auto/ZXing, marco verde, marco 4:3 fijo `h-80`).

---

## 6. Diagnóstico: fallas encontradas y fixes

| # | Síntoma | Causa raíz | Fix |
|---|---|---|---|
| 1 | `tsc` fallaba en todo `features/scanner` | Imports `../` en vez de `./`; los archivos nunca habían compilado | Rutas a `./` |
| 2 | `TS1294 erasableSyntaxOnly` | `constructor(private windowMs...)` | Campo + asignación explícita |
| 3 | `opts.onError` no existe en tipo | Tipo inline de `start()` sin `onError` | Agregado opcional + `?.` |
| 4 | Resolver no tipaba | Faltaba `matchedVia` en resolvers de vistas | Agregado `'primary'` |
| 5 | `cap.torch` no existe en lib TS | `MediaTrackCapabilities` sin torch | Cast `(cap as any)?.torch` |
| 6 | URLs LAN dejaron de andar (HTTPS) | Cert self-signed bloquea navegación | HTTPS opcional: `npm run dev` (HTTP) / `dev:https` |
| 7 | "No se pudo iniciar el escáner" | `div#barcode-reader` condicional (`isStreaming`) no existía al llamar `start()` | Render siempre + overlay de carga |
| 8 | Error real invisible | Engine tragaba errores (`onError` no pasado) | `throw` + `console.error('[Scanner] start error:')` |
| 9 | `container dims: 615 x 0` | `aspect-ratio` + hijo `h-full` colapsa a 0 | Contenedor `h-80` + hijo `absolute inset-0` + `minHeight` |
| 10 | Múltiples instancias de scanner | `start()` llamaba `stop()` sin `await` | `await this.stop()` |
| 11 | Personalizado no carga datos | `useEffect` solo con `[dateRange]`; DatePicker solo hace `setCustomRange` | Deps `[dateRange, customRange]` |
| 12 | Total `$126.314,33` desborda el donut | Hueco ~100px < texto 18px | Centro compacto (`$126,3 mil`), exacto en tooltip + leyenda |
| 13 | Botón Configuración no hacía nada | Sin `onClick` ni vista | Eliminado → luego `SettingsView` real (negocio + ubicaciones + fiscal + respaldo) |
| 14 | Altas nacían `admin` | Default en `fetchProfile` + fallback | Default `vendedor` (agujero cerrado) |
| 15 | Vendedor veía/editar todo | Sin gates ni RLS | RLS por rol + gates UI (ver §8) |
| 16 | Movimientos sin autor | `openMoves` leía legado sin `user_id` | Lee `inventory_movements` + nombres, fallback legado |

## 7. Auditoría por usuario (implementado)

- **Historial** (todos): ventas con vendedor + filtro por vendedor.
- **Productos → movimientos**: cada renglón muestra autor + saldo `antes → después`.
- **Usuarios → Ver** (admin; lectura supervisor): últimas 20 ventas + 30 movimientos de esa persona.
- **Mi actividad** (todos los roles): ventas + movimientos propios + total vendido.
- Hacia adelante todo queda firmado (`auth.uid()` en RPCs); lo viejo sin `user_id` sale sin nombre.

## 8. Matriz de permisos vigente (v2)

- **Vendedor**: POS, alta/edición productos y códigos, proveedores/clientes, ingresos (crear+confirmar), ver todo. NO: DELETE nada, baja/reactivar, cancelar ingresos, anular, ubicaciones, usuarios.
- **Supervisor**: + ver/anular todas las ventas, Usuarios en lectura + actividad. NO: cambiar roles, borrar.
- **Admin**: todo (único que borra, ubicaciones, usuarios, configuración).

## 9. Verificación estándar (repetir tras cada cambio)

```
npm run build   # tsc + vite, 0 errores
npm test        # 21 tests (18 base + 3 scaleParser)
npm run lint    # 0 errores (warnings preexistentes ok)
```
