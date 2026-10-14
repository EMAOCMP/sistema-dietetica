# Estructura nueva: Escáner para Nuevo Producto (Barcode Capture v2)

> Estado: PROPUESTA para análisis. No implementada. Sin cambios en código hasta aprobar.

## 1. Diagnóstico del problema actual

El `ScannerModal` genérico hace: **capturar → resolver contra DB → panel → usar**.
Para **Nuevo Producto** eso juega en contra:

- El producto **no existe todavía** → el resolver siempre devuelve `not_found` (esperable, pero suma un paso y un panel innecesario).
- El flujo depende de **red + RLS + tablas** (`product_barcodes`) para algo que es solo "dame el texto del código".
- La **cámara en vivo en PC** (webcam foco fijo) es el eslabón más frágil: permisos, dimensiones, foco.

## 2. Idea central

**Separar captura de resolución.**

- Nuevo Producto solo necesita **CAPTURA + VALIDACIÓN LOCAL** (formato/checksum + duplicados contra la lista ya cargada en memoria). Cero red, cero DB, funciona offline.
- POS / Ingreso siguen con `ScannerModal` + resolver (ahí sí importa buscar en DB). No se tocan.

## 3. Flujo nuevo (Productos → Nuevo → Escanear)

1. Click "Escanear" junto al campo código → abre `BarcodeCapture` (modal chico, solo captura).
2. Métodos en orden de confiabilidad:
   a. **Lector físico USB/BT**: si está conectado, escanea directo — el campo se llena solo si el formulario está abierto (sin abrir nada).
   b. **Foto** (botón hero): `scanFile()` sobre imagen fija. Sin stream, sin permisos de video.
   c. **Manual**: tipeo con validación en vivo.
   d. **Cámara en vivo**: colapsada por defecto (útil en teléfono).
3. Al capturar → validación local:
   - ✅ válido → beep, llena el campo, marca ✓ "verificado", cierra.
   - ❌ checksum/longitud mal → rojo con motivo, no llena.
   - ⚠️ duplicado en OTRO producto → ámbar con nombre del dueño + botones [Usar igual] [Reintentar].
   - Mismo producto en edición → se permite (no es duplicado).

## 4. Archivos y configuraciones

### NUEVOS (2 archivos, 0 dependencias nuevas)

- `src/features/scanner/components/BarcodeCapture.tsx`
  UI de captura para formularios. Props: `onCapture(code, meta)`, `onClose`,
  `existing: { barcode, id?, name? }[]`, `editingId?`, `title?`.
  **Sin supabase. Sin ScannerProvider.** Foto/manual van directo a validación;
  el live instancia su **propio** `CameraScannerEngine` local (no pisa el
  resolver global del POS). Cero efectos colaterales.
- `src/features/scanner/services/barcodeValidator.ts`
  Reusa `normalizeCode` + `plausibleCode` existentes. Expone:
  `validateBarcode(code)` y `findDuplicate(code, existing, editingId?)`.
- `src/features/scanner/services/__tests__/barcodeValidator.test.ts`
  Tests: checksum ok/mal, UPC→EAN, duplicado otro/mismo/ninguno.

### MODIFICAR (1 archivo)

- `src/components/ProductsView.tsx`
  - El botón escanear del formulario abre `BarcodeCapture` en vez de `ScannerModal`.
  - `onCapture` → `setBarcode` + `setScannedOk(true)` (+ warning si duplicado).
  - Lector físico: al abrir el formulario, registrar `setOnDetected` temporal que
    llena el campo; al cerrar, restaurar. (Si el formulario está cerrado, el
    hardware sigue el flujo normal de la vista.)

### SIN CAMBIOS

- `App.tsx`, `Navbar.tsx`: sin rutas ni tabs nuevos.
- `ScannerModal`, `ScannerProvider`, POS, Ingreso: no se tocan.
- SQL/RLS: nada (validación 100% local).
- `package.json` / `vite.config`: nada (`html5-qrcode` ya instalado).
- Permisos navegador: la foto usa `<input capture="environment">` (en PC abre
  selector de archivos, sin permiso de video).

## 5. Casos borde

| Caso | Comportamiento |
|---|---|
| Sin red / offline | Funciona igual (todo local) |
| Foto borrosa | Mensaje + "Sacar otra" (preview visible) |
| Código inválido | Rojo con motivo, no llena el campo |
| Duplicado otro producto | Ámbar + nombre dueño + [Usar igual] |
| Editando el mismo producto | Permitido, sin warning |
| Lector USB + formulario cerrado | Lo maneja la vista activa (sin cambios) |

## 6. Verificación (después de aprobar)

1. `npm run build` + `npm test` (incluye test nuevo).
2. Foto de EAN-13 real → campo lleno + ✓.
3. Tipeo con dígito mal → error rojo, no llena.
4. Código de otro producto → warning con nombre.
5. Lector USB con formulario abierto → llena directo.
