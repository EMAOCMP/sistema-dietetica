# Dietética Vishal — Estructura del Proyecto

Sistema de gestión de stock y ventas para dietética, con PWA, modo offline y backend en Supabase.
Repositorio: `EMAOCMP/sistema-dietetica` — Despliegue: **Supabase** (datos + API) y **Vercel** (frontend).

---

## Estructura del repositorio

```
sistema-dietetica/
├── src/                      # Frontend (React + TypeScript + Vite)
│   ├── components/           # Vistas de la app (Panel, POS, Productos, Historial…)
│   ├── features/scanner/     # Motor de escaneo de códigos de barras
│   ├── lib/                  # Lógica de negocio y servicios (ventas, sync, offline, exports)
│   ├── hooks/                # Hooks reutilizables
│   ├── types/                # Tipos compartidos (roles, productos, ventas)
│   └── test/                 # Setup de tests unitarios (Vitest)
├── supabase/
│   ├── *.sql                 # 28 scripts SQL: modelo, RPCs, triggers, permisos RLS
│   └── functions/            # Edge Functions (backup, Mercado Pago)
├── public/                   # Íconos PWA (manifest, favicons, logos)
├── docs/                     # Documentación técnica (escáner, Figma, móvil)
├── scripts/                  # Utilidades locales (iniciar/detener dev server)
├── tests/                    # Tests E2E (Playwright)
├── vite.config.ts            # Build + PWA (service worker) + envPrefix
├── vitest.config.ts          # Tests unitarios
└── playwright.config.ts      # Tests end-to-end
```

**Comandos:** `npm run dev` (desarrollo) · `npm run build` (compila para producción) ·
`npm test` (67 tests unitarios) · `npm run test:e2e` (Playwright) · `npm run lint` (oxlint)

---

# ETAPA 1 — Supabase (Base de Datos y Backend)

## 1.1 Modelo de datos

### Tablas principales

| Tabla | Función |
|---|---|
| `products` | Maestro de productos: nombre, código, categoría, unidad (un/kg), costos, precios mayorista/minorista, stock, mínimo, vencimiento, proveedor, activo/inactivo |
| `product_barcodes` | Múltiples códigos de barras por producto (principal + alias, con normalización EAN-13/UPC-A) |
| `inventory` | **Stock real por ubicación** (PK producto+ubicación, decimal para kilos). Escritura solo vía RPC |
| `inventory_movements` | Auditoría append-only de todo movimiento de stock: compra, venta, ajuste, devolución, pérdida, transferencia |
| `locations` | Ubicaciones de stock (Local principal, depósitos) |
| `sales` | Cabecera de venta: número de ticket correlativo, total, ganancia, medio de pago, estado (completada/anulada), cliente, condición IVA, tipo (interno/ARCA), datos MP |
| `sale_items` | Ítems de cada venta con precio de costo congelado al momento de vender (clave para la rentabilidad) |
| `payments` | Detalle de cobro: método, importe, banco/alias de transferencia, marca y últimos 4 dígitos de tarjeta, cuotas |
| `sale_counters` | Correlativo de tickets (compare-and-swap para evitar numeración duplicada) |
| `stock_receipts` / `stock_receipt_items` | Ingreso de mercadería (numeración `ING-######`), con estados borrador → confirmado → cancelado |
| `profiles` | Usuarios de la app: nombre, correo y rol (`admin` / `supervisor` / `vendedor`) |
| `user_settings` | Configuración por usuario (incluye la **meta diaria de ventas**) |
| `cash_closes` | Cierre/arqueo de caja diario: esperado vs contado, diferencia |
| `expenses` | Gastos del negocio (alquiler, servicios, insumos…) para la ganancia neta |
| `suppliers` / `customers` / `categories` | Maestros de proveedores, clientes y categorías (jerárquicas) |
| `product_batches` | Lotes con vencimiento (alertas de vencimiento) |
| `card_brands` | Marcas de tarjeta (visa, mastercard, cabal… con alta automática) |
| `purchase_orders` | Órdenes de compra a proveedores |
| `audit_logs` | Registro de auditoría (old/new JSONB por usuario) |

### Relaciones clave

```
locations 1─∞ inventory ∞─1 products 1─∞ product_barcodes
                │                ├─1─∞ inventory_movements
                │                └─1─∞ product_batches
sales 1─∞ sale_items ∞─1 products
sales 1─∞ payments
stock_receipts 1─∞ stock_receipt_items ∞─1 products
sales, cash_closes, expenses, user_settings ∞─1 profiles
```

## 1.2 Lógica de negocio en el servidor (RPCs / funciones SQL)

Todas las operaciones críticas son **funciones atómicas** (`SECURITY DEFINER`, con bloqueo de filas
`FOR UPDATE`, idempotencia y rollback total ante cualquier fallo):

| Función | Proceso que resuelve |
|---|---|
| `create_sale(...)` | **Venta transaccional**: inserta venta + ítems + pago, descuenta stock de `inventory`, registra movimiento `sale` y devuelve el ticket. Si el `idempotency_key` ya existe, devuelve la venta existente (nunca duplica) |
| `cancel_sale(id)` | **Anulación**: solo admin/supervisor; pasa la venta a `cancelled` y **restituye el stock** con movimiento `return` |
| `confirm_stock_receipt(...)` | **Ingreso de mercadería**: confirma el borrador y suma stock en la ubicación destino, con clave de idempotencia |
| `adjust_stock(...)` | Ajustes manuales de stock; lanza error si quedaría negativo |
| `transfer_stock(...)` | Transferencia entre ubicaciones: baja en origen + alta en destino, idempotente |
| `next_stock_receipt_number()` | Genera correlativo `ING-000001` |
| `user_role()` | Devuelve el rol del usuario logueado (base de todos los permisos; mínimo privilegio: sin perfil → `vendedor`) |
| `normalize_barcode()` | Normaliza códigos (UPC-A de 12 dígitos → EAN-13 con cero inicial) |

**Triggers activos:**
- `trg_inventory_sync_product` → cada movimiento en `inventory` recalcula `products.stock_quantity` (espejo de compatibilidad).
- `trg_stock_sale` → el insert de `sale_items` descuenta stock (vía de respaldo si falla el RPC).
- `trg_barcode_normalized` → mantiene normalizado el código de barras.
- `update_updated_at` → marca de actualización en tablas maestras.

## 1.3 Seguridad — Row Level Security (RLS)

Los permisos viven en la base de datos, no solo en la interfaz: `roles_permisos.sql` define políticas
por tabla usando `user_role()`. Resumen:

| Tabla | admin | supervisor | vendedor |
|---|---|---|---|
| `products` | CRUD completo | edita (no da de baja) | edita solo activos |
| `sales` (lectura) | todas | todas | **solo las suyas** |
| `sales` (modificar) | ✔ | ✔ | ✖ |
| `inventory` / `inventory_movements` | solo lectura + RPCs para todos — **escritura directa prohibida** |||
| `stock_receipts` | CRUD | confirma, no cancela | crea/confirma |
| `locations` | CRUD | ✖ | ✖ |
| `profiles` | admin gestiona | ✖ | ✖ |
| `cash_closes`, `expenses` | CRUD | CRUD | ✖ |
| `user_settings` (meta diaria) | propio | propio | propio |

## 1.4 Edge Functions

| Function | Función |
|---|---|
| `daily-backup` | Respaldo automático diario (07:00 UTC) de ventas, ítems, pagos, gastos, cierres y snapshot de productos a un bucket privado `backups/` |
| `mp-create-preference` | Crea la preferencia de Checkout Pro de Mercado Pago (token en Secrets, nunca en el navegador) |
| `mp-webhook` | Recibe la notificación de MP y actualiza el estado del pago en `sales` (`mp_status`) |

## 1.5 Modelo offline (definido en el backend)

- El servidor acepta reintentos con `idempotency_key` (índices únicos parciales) → un cliente sin red
  puede reenviar la misma operación sin duplicar ventas ni tickets.
- Backup diario con `pg_cron` + `pg_net`.

---

# ETAPA 2 — Frontend (React + TypeScript + Vite)

## 2.1 Stack

- **React 19 + TypeScript** (type-check en cada build con `tsc -b`).
- **Vite 8** con **Tailwind CSS 4**, tema claro/oscuro (por defecto oscuro).
- **PWA con vite-plugin-pwa**: service worker con precache y caché `NetworkFirst` de la API de
  Supabase → la app funciona sin conexión y se actualiza sola.
- **IndexedDB** (`idb`) como almacenamiento local: caché de productos + cola de sincronización.
- **Supabase JS v2**: Auth, PostgREST, Realtime y RPC.
- **Gráficos** SVG propios (sin librería pesada) para tendencia, donut de pagos, etc.
- **Exports**: CSV / Excel (exceljs) / PDF (jsPDF) / impresión térmica 80 mm.
- **Calidad**: Vitest (67 tests), Playwright (E2E), oxlint.

## 2.2 Estructura de `src/`

```
src/
├── App.tsx                 # Shell: sesión, navegación por pestañas, tema, toasts, sync engine
├── components/             # 10 vistas + widgets (Dashboard, POS, Products, History, Users…)
├── features/scanner/       # Motor de escaneo multi-dispositivo
│   ├── engines/            # Cámara | Lector hardware USB/BT | Foto
│   ├── services/           # normalizador, validador, resolución, pipeline, balanza (PLU)
│   └── hooks/              # useScanner, useBarcodeResolution, useScanGuard
├── lib/                    # salesService, cartService, syncEngine, offlineDB, receipt,
│                           # exportXlsx, reportPdf, mercadoPagoService, metaSchedule, tax…
├── hooks/                  # useOnlineStatus y otros
└── types/                  # Profile, roles, productos, ventas
```

## 2.3 Autenticación y roles

- Login con correo y contraseña (Supabase Auth) + alta del primer usuario administrador +
  flujo de "Nueva Contraseña".
- Al entrar se lee/crea el registro en `profiles` con rol por defecto `vendedor`.
- Roles: **admin** (total) · **supervisor** (control: stock, alertas, reportes, ventas) ·
  **vendedor** (caja/POS).

## 2.4 Arquitectura offline-first

1. **`offlineDB.ts`** — IndexedDB con 5 almacenes: caché de productos, **cola de ventas/ajustes/altas**,
   clientes, ajustes y metadatos de sincronización.
2. **`syncEngine.ts`** — arranca con la app; sincroniza cada 10 s y al recuperar conexión:
   - procesa la cola en lotes de 5 (respetando el orden),
   - envía cada operación a su RPC (`create_sale`, `adjust_stock`, alta/edición de productos),
   - hasta 5 reintentos por ítem; la cola es visible en el indicador de notificaciones.
3. **Sin conflictos destructivos**: la idempotencia en el servidor garantiza que reenviar no duplica.
4. **UI offline**: el POS emite ticket `OFF-xxxxxx`, aplica stock optimista local y muestra el
   indicador de "operaciones pendientes" en el menú.

## 2.5 Escáner de códigos de barras (`features/scanner`)

Un único pipeline compartido por POS, Productos e Ingreso de mercadería:
normalizar → detectar formato → validar → ¿es de balanza? (PLU + peso) → resolver producto
(caché local → balanza → consulta a `product_barcodes`/`products`).
Tres motores intercambiables: **cámara del dispositivo**, **lecturador hardware** (USB/Bluetooth)
y **foto**. Protección contra doble disparo y tests unitarios del pipeline.

## 2.6 Build y despliegue

- `npm run build` → `tsc -b && vite build` → carpeta `dist/` (lo que sirve Vercel).
- Variables de entorno en Vercel: `SUPABASE_URL` y `SUPABASE_ANON_KEY` (expuestas al cliente vía
  `envPrefix` en `vite.config.ts`).
- Cada push a la rama principal dispara el build en Vercel.

---

# ETAPA 3 — Funcionamiento de la Aplicación

## 3.1 Mapa de navegación

| Pestaña (menú) | Qué hace |
|---|---|
| **Panel Principal** | Resumen operativo: ventas, metas, alertas |
| **Venta Rápida (POS)** | Caja: cobrar tickets |
| **Productos / Stock** | ABM de productos y control de stock |
| **Ingreso Mercadería** | Recepción de proveedor (lotes y vencimientos) |
| **Pedidos & Historial** | Trazabilidad de ventas y comprobantes |
| **Mi actividad** | Ventas y movimientos propios del usuario |
| **Cierre de Caja** | Arqueo diario: esperado vs contado |
| **Reportes de Ganancias** | Facturación, costos, gastos y ganancia neta |
| **Usuarios y Actividad** | Alta de usuarios, roles y auditoría |
| **Configuración** | Datos del negocio, IVA, Mercado Pago, ubicaciones |

Atajos: `Ctrl/⌘+K` (paleta de comandos y búsqueda global), barra inferior móvil con botón central
**"Escanear"**, y badges en el menú (stock crítico en rojo, operaciones offline pendientes en azul).

---

## 3.2 Panel de Control — "Resumen Operativo"

Título: **"Resumen Operativo — Control en tiempo real de ventas y stock"**.
Se actualiza solo: cada 30 s, al haber una venta en la sesión y en **tiempo real** (canal Realtime
de Supabase sobre `sales`, sirve también para ventas hechas desde otro dispositivo).

### Selector de período y exportaciones (cabecera)

- **Hoy / Semana / Mes / Personalizado** (calendario hasta el día de hoy, con presets: Ayer,
  Últimos 7/30 días, Este mes, Mes pasado, Este año).
- **Exportar:** *Ventas (CSV)* con ganancia e ítems · *Contador (CSV)* fiscal sin ganancia ·
  *Reporte (PDF)* · *Imprimir vista*.
- Botón **"Caja"** → acceso directo al POS.

### Accesos rápidos (6 botones)

| Botón | Lleva a |
|---|---|
| **Venta Rápida** | POS |
| **Productos** | Gestión de productos y stock |
| **Stock Crítico** | Modal con desglose y costo de reposición |
| **Ventas** | Modal "Detalle de Ventas & Cierre de Caja" |
| **Rentabilidad** | Modal "Balance de Ganancias y Rendimiento" |
| **Pedidos** | Historial y trazabilidad |

### Meta de Ventas Diaria

- Se define en la propia tarjeta (**"Definir meta" ⚙**). Se guarda en la tabla `user_settings`
  (`daily_goal`) y como respaldo local; es **por usuario**.
- **Barra de progreso**: `ventas de hoy / meta`. Siempre mide **hoy**, sin importar el período
  seleccionado en el resto del panel.
- **Mensajes de ritmo** según la hora (horario de meta configurable en Configuración, por defecto
  08:00–21:00):
  - `🎉 ¡Meta cumplida!` (al 100%, con aviso único por día)
  - `Vas bien · cierre proyectado $… (quedan X h)`
  - `Vas atrasado · al ritmo actual cerrás en $…`
  - `Abrimos a las 08:00 · faltan $…` / `Día cerrado: alcanzaste el X%`
- **Mini-historial "ÚLTIMOS 7 DÍAS"**: barra por día, verde si cumplió el objetivo, con contador
  **"X/7 cumplidos"**.
- La campana de notificaciones repite el aviso "¡Meta diaria cumplida!".

### Las 4 tarjetas KPI

| Tarjeta | Qué muestra | Al hacer clic |
|---|---|---|
| **Ventas (Tickets)** | Cantidad de tickets del período + variación **% vs período anterior** + **Ticket Promedio** (facturación ÷ tickets) + enlace "Ver Último Ticket →" | Modal "Detalle de Ventas & Cierre de Caja" |
| **Ingresos Totales** | Suma de `total_amount`, desglosada en **Efectivo** y **Digital** (transferencia + tarjeta) | Modal "Desglose de Facturación & Pagos" |
| **Ganancia Neta** | Suma de `profit_amount` + **Margen Global %** + reparto **Retira / Envío** | Modal "Balance de Ganancias y Rendimiento" |
| **Stock Crítico** | Cantidad de productos por debajo del mínimo (+ estados "Requiere Reposición" / "Stock Normal") | Modal "Desglose de Stock Crítico" |

> Las ventas anuladas quedan excluidas de todas las métricas.

### Gráficos y paneles analíticos

- **Tendencia de Ventas** (o *Intradía por hora* si el período es "Hoy"): pestañas conmutables
  **Ingresos / Tickets / Ganancia**, con promedio, mejor período y tooltip.
- **Distribución de Pagos**: donut Efectivo / Tarjeta / Transferencia con montos y porcentajes.
- **Top Clientes**: ranking top 5, por monto o por cantidad de compras (medallas 1-2-3).
- **Productos por Vencer (30 días)**: tabla con días restantes y aviso `¡VENCIDO!`.
- **Top 10 Productos Estrella**: por cantidad o por $, con % de participación.
- **Rentabilidad por Categoría**: ganancia y margen por categoría (semáforo: ≥40% verde,
  ≥25% ámbar, <25% rojo).
- **Horarios Pico**: franja horaria con mayor demanda y valle del día.
- Cada panel se amplía a modal a pantalla completa.

### Alertas y utilidades

- **Onboarding "¡Bienvenido al sistema!"** (3 pasos: cargar productos, registrar primera venta,
  revisar historial) — se oculta al completarse.
- **Buscador rápido** por nombre o código de barras (top 6, click → Productos).
- **Banner de stock crítico** con botón "Ver Stock".
- **Orden de compra sugerida**: agrupa los productos en crítico por proveedor, calcula cantidad
  sugerida (`mínimo × 2 − stock`) y costo estimado, con acciones **WhatsApp** (mensaje automático
  al proveedor) y **📋 Copiar orden**, y marcado de "Pedido" por producto.
- **Aviso de rol vendedor**: "Mostrando solo tus ventas…" — un vendedor solo ve las ventas que
  registró (política RLS, no un filtro de la interfaz).

---

## 3.3 Venta Rápida (POS)

- Búsqueda por nombre/código, escáner (cámara o hardware), venta por kilo con **Balanza** (PLU),
  precios mayorista/minorista, descuento por ítem o global, costo de envío (fijo o %).
- **Carrito → COBRAR (F12)** con comprobante **Interno** o **ARCA** (CUIT/DNI + condición IVA).
- **Medios de pago**: Efectivo (con "Paga con" y vuelto) · Transferencia (banco/alias/ref.) ·
  Tarjeta (marca, últimos 4, autorización, cuotas) · **Mercado Pago** (link de pago vía Edge Function).
- **Ventas en espera (multiticket)** con tecla `P`, últimos tickets para reimprimir/anular.
- Al cobrar: modal **"¡Cobro Exitoso!"** con envío por WhatsApp, copiar texto o imprimir ticket
  térmico 80 mm.
- **Sin conexión**: la venta se encola con ticket `OFF-xxxxxx` y se sincroniza sola al volver la red.

## 3.4 Productos / Stock

- ABM completo: código (con escáner o generador), nombre (detecta duplicados), categoría, unidad
  (un/kg), costos y precios con **calculadora de margen en vivo** y alerta de venta a pérdida,
  stock inicial, mínimo de alerta, vencimiento, proveedor y foto (storage `product-images`).
- Vistas: activos / dados de baja, filtros (categoría, 🔴 críticos, ⏳ por vencer), orden, selección
  múltiple, densidad cómoda/compacta.
- Herramientas: **Conteo físico**, **Lista de precios**, **Etiquetas** de góndola, **Importar CSV**,
  **Excel**, **Aumento %** masivo, alerta de stock crítico por WhatsApp.
- Por producto: entrada/salida de stock con motivo, historial de movimientos, historial de precios,
  duplicar, editar, dar de baja / reactivar.
- Offline: altas, ediciones y ajustes de stock se encolan y sincronizan.

## 3.5 Ingreso de Mercadería

- Flujo por borrador: **"Nuevo ingreso"** (correlativo `ING-######`) → escanear/agregar líneas con
  cantidad, costo, lote y vencimiento → elegir ubicación destino → **"Confirmar ingreso"**.
- El stock **recién suma al confirmar** (RPC transaccional e idempotente), y actualiza el costo.
- Alta rápida de producto nuevo desde el escáner si el código no existe.
- **Transferencias** entre ubicaciones y **historial** de últimos ingresos (borrador/confirmado/cancelado).

## 3.6 Pedidos & Historial

- Filtros: período, ticket o cliente, vendedor, medio de pago, tipo (interno/ARCA), despacho,
  estado (completadas/anuladas) + KPIs de Ventas, Facturación y Ganancia del filtro.
- Fila expandible **"Trazabilidad • Comprobante N°"**: ítems, vendedor, pago, despacho, ganancia
  estimada y **Reenviar comprobante** (WhatsApp con validación de número / Copiar / Imprimir).
- **Anular venta** con confirmación → devuelve el stock automáticamente (RPC `cancel_sale`).
- Export para el contador (XLSX fiscal) y XLSX completo con gráfico de ventas por día.

## 3.7 Cierre de Caja

- "Esperado del día vs contado real del cajón": el sistema calcula ventas del día, **efectivo
  esperado** y transferencia + tarjeta; se ingresa el **contado real** y muestra
  **"✓ Cuadra"** o el sobrante/faltante.
- Se guarda **un cierre por fecha** (upsert), con notas, impresión e historial de últimos cierres.

## 3.8 Reportes de Ganancias

- Vistas **Diario / Semanal / Mensual** con navegación de períodos y KPIs comparativos:
  Tickets, Facturación, Ganancia bruta, **Gastos**, Ganancia neta, Margen neto %.
- Tabla por período con totales + **Ganancia por vendedor**.
- Módulo **"Gastos del negocio"**: registrar gastos (fecha, descripción, monto, categoría) que
  descuentan de la ganancia neta. Export CSV y PDF.

## 3.9 Usuarios y Actividad

- Nómina por rol (Admins / Supervisores / Vendedores), cambio de rol con validación
  ("No puedes quitarte el rol de Administrador a ti mismo").
- Por usuario: **Actividad** → últimas ventas y movimientos de stock.
- Al pie, la **matriz de permisos** de referencia:

  | Rol | Alcance |
  |---|---|
  | **admin** — Administrador (Total) | Productos, costos, usuarios, reportes, caja |
  | **supervisor** — Supervisor (Control) | Stock, alertas, reportes, ventas |
  | **vendedor** — Vendedor (Caja/POS) | Caja / POS |

## 3.10 Configuración

- **Datos del negocio (tickets)**: nombre, CUIT, dirección, teléfono, pie del ticket.
- **Fiscal y comercial**: alícuota IVA (21 / 10,5 / 0%), punto de venta, margen objetivo %.
- **Horario de la meta diaria**: apertura/cierre que alimenta el ritmo y cierre proyectado del Panel.
- **Mercado Pago**: modo prueba/producción, tokens y "Probar conexión" con la Edge Function.
- **Respaldo CSV** de productos y ventas.
- **Ubicaciones de stock**: altas y baja de locales/depósitos.

## 3.11 Notificaciones (campana)

Se calculan en tiempo real cada 60 s: **stock crítico**, **lotes por vencer** (30 días),
**operaciones offline pendientes** y **"¡Meta diaria cumplida!"**.

---

## Resumen de los tres avances

| Etapa | Entregable | Dónde vive |
|---|---|---|
| **1 · Supabase** | Modelo de datos, RPCs transaccionales, RLS por roles, Edge Functions y backup | `supabase/` + proyecto en Supabase |
| **2 · Frontend** | PWA React/TS, módulos, escáner, offline-first y build | `src/` + despliegue en Vercel |
| **3 · Funcionamiento** | Panel de control, POS, stock, historial, cierre, reportes y usuarios | Aplicación en producción |
