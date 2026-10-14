# App móvil Dietética Vishal — Lista para Figma

> Basada en la app actual (tabs, modales y flujos reales). Mobile-first 390×844.
> Orden de construcción sugerido: 1 Fundación → 2 Componentes → 3 Pantallas → 4 Prototipo.

---

## 1. FUNDACIÓN (Styles)

### Colores (crear como Variables / Styles)
| Token | Valor | Uso |
|---|---|---|
| Primary | Emerald `#059669` (hover `#047857`) | Cobrar, Confirmar, Guardar |
| Brand | Naranja `#FF6B00` | Logo, acentos, badges |
| Fondo claro | `#F4F7F6` / Slate-50 cards | Base light |
| Fondo oscuro | Obsidian `#161616` / `#1F1F1F` cards | Base dark (default de la app) |
| Peligro | Red `#DC2626` | Baja, anular, inválido |
| Aviso | Amber `#D97706` | Pendiente, duplicado, foco fijo |
| Info | Sky `#0284C4` | Links, resolviendo, live |
| Texto | Slate-900 / Zinc-200 dark, Slate-500 secundario | — |

### Tipografía (sistema nativo: San Francisco / Roboto)
- H1 pantalla: Extrabold 22–24, tracking-tight
- Título card: Bold 14–16
- Cuerpo: Regular/Medium 13–14
- Números/precios: **Mono tabular** Bold (clave: `$ 1.250,00`, stocks, cantidades)
- Micro-labels: Bold 10–11 uppercase tracking-widest, Slate-400

### Radios y sombras
- Cards: `rounded-2xl` (16px), Modales: `rounded-3xl` (24px), Botones: `rounded-xl` (12px)
- Sombra card suave; modal con backdrop `black/60 + blur`

### Iconos
Estilo Lucide/Phosphor outline 1.5–2px, 16–22px. Set mínimo: home, cart, box, truck, clock, users, chart, gear, camera, image, flashlight, search, plus, edit, trash, check, x, printer, share/whatsapp.

---

## 2. COMPONENTES (con Variants + Auto Layout)

1. **BtnPrimary** (Emerald; variants: default/pressed/disabled/loading)
2. **BtnDark** (Slate-900 / blanco en dark; para Buscar, Escanear)
3. **BtnGhost / BtnDanger / IconBtn** (X, basura, linterna, cámara)
4. **InputText / InputSearch / InputNumberMono / InputDate / Select / StepperQty (+/−)**
5. **AppHeader móvil**: logo + buscador ⌘K + campana + tema + avatar/rol
6. **BottomTabBar** (5 destinos + Más): Panel, Venta, Escanear (botón central destacado), Stock, Más
7. **KPICard**: título, valor grande mono, subtítulo/delta, tap → modal detalle
8. **ProductCard / ProductRow**: nombre, categoría, precio, badge stock (ok/bajo/cero), thumb
9. **CartBar / CartSheet**: resumen (ítems, total), [Guardar] [Cobrar]
10. **PaymentMethods**: segmented Efectivo/Transferencia/Tarjeta + sub-form (banco, tarjeta, cuotas)
11. **Ticket**: encabezado negocio, líneas, totales, footer + botones [Imprimir] [WhatsApp] [Nuevo]
12. **ScannerFrame**: marco verde 80×60 + hint "Apuntá el código dentro del marco"
13. **ScanPanels**: `found` (verde: nombre/stock/precio + [Agregar/Usar]), `not_found` (ámbar + [Crear producto]), `invalid` (rojo + motivo)
14. **ModalSheet**: contenedor bottom-sheet (handle, título + X, contenido scroll)
15. **StatusBadge**: Borrador/Confirmado/Cancelado, Completada/Anulada, roles (Admin/Sup/ Vend)
16. **Toast**: success/info 3.5s, warning/error 6s + icono
17. **EmptyState**: icono + texto + CTA (ej. "Sin productos", "Sin ventas")
18. **SyncBadge / OfflineBanner**: "Sin conexión — se sincronizará solo"
19. **MoveRow**: tipo + referencia + saldo antes→después + usuario + fecha
20. **UserRow**: avatar, nombre, email, badge rol, [Ver actividad]

---

## 3. PANTALLAS (frames 390×844, dark + light donde aplique)

### A. Acceso
- A1 Splash/Loading ("Cargando Dietética Vishal…")
- A2 Login (email + password + entrar; error de credenciales)

### B. Panel Principal
- B1 Resumen Operativo: saludo, rango (Hoy/Semana/Mes/Personalizado), Exportar, KPIs (Ventas, Revenue, Ticket medio, Ganancia), Meta diaria con barra, buscador rápido, alertas stock, gráficos (Pagos donut, categorías, horarios), top productos/clientes, últimas ventas
- B2–B9 Modales de cada KPI/tarjeta (detalle ventas, revenue, profit, stock crítico, último ticket, best sellers, categorías, horario)
- B10 DatePicker custom (calendario + [Limpiar] [Listo])

### C. Venta (POS)
- C1 POS: buscador + lector, chips categorías, grilla productos, botón cámara
- C2 Carrito abierto: líneas (qty stepper, precio mayorista/minorista), descuento, envío, total
- C3 Cobrar: método + detalle + recibido/vuelto + [COBRAR]
- C4 Ticket éxito + acciones (imprimir/WA/nueva venta)
- C5 Tickets en espera + recientes (reimprimir/anular con confirm)

### D. Escáner (flujo transversal, reusar en C/E/F)
- D1 Foto hero [SACAR FOTO] + preview + manual + [Buscar]
- D2 Panel found / D3 not_found / D4 invalid
- D5 Cámara en vivo: selector cámara, marco verde, controles (continuo, linterna, motor, zoom), [Analizar cuadro], línea técnica (`1280×720 · nativo · trasera`)
- D6 Permiso denegado / sin cámara / contexto inseguro (mensaje HTTPS)
- D7 Diagnóstico (variantes + autotest) — solo debug

### E. Productos / Stock
- E1 Lista + search + filtros (categoría, críticos, por vencer) + sort
- E2 Fila expandida: proveedor, margen, valorizado, código + [Ver movimientos] [Ver precios] [Editar]
- E3 Nuevo/Editar: datos, precios, stock, foto + campo código con [Escanear] + ✓ verificado
- E4 Ajuste rápido (entrada/salida + motivo), E5 Movimientos (con autor), E6 Historial precios
- E7 Etiquetas (preview códigos), E8 Importar CSV, E9 Proveedores (lista + alta)

### F. Ingreso Mercadería
- F1 Lista (borradores + confirmados) + [Nuevo ingreso] + [Transferir] (admin/sup)
- F2 Ingreso activo: ING-000184, buscador/escanear, líneas (cant/costo/lote/vence), proveedor, notas
- F3 Confirmación: [Continuar escaneando] [CONFIRMAR INGRESO · $total] + éxito
- F4 Transferencia: Desde/Hacia (select ubicaciones), producto, cantidad, nota, [Transferir]
  (panel sky-blue, visible solo admin/supervisor, oculto con ingreso activo)

### G. Historial
- G1 Filtros (fecha, vendedor, pago, tipo, estado) + exportar
- G2 Ticket detalle + [Reimprimir] [Anular] (con confirm y motivo visual)

### H. Actividad y Usuarios
- H1 Mi actividad: total vendido, mis ventas, mis movimientos
- H2 Usuarios (admin): tabla + cambio de rol + [Ver] por fila
- H3 Actividad por usuario (modal): ventas + movimientos de esa persona

### I. Configuración (admin)
- I1 Datos del negocio (nombre, CUIT, dirección, teléfono, pie ticket)
- I2 Fiscal (IVA, punto de venta, margen) + Respaldo CSV
- I3 Ubicaciones (alta Local/Depósito, activar/desactivar, eliminar)

### J. Estados globales
- J1 Sin conexión (banner + cola pendiente)
- J2 Sincronizando
- J3 Vacío genérico / Error genérico con [Reintentar]

### K. Cierre de caja (admin/supervisor)
- K1 Header con selector de fecha (hoy por defecto) + métricas: Ventas, Total,
  Efectivo esperado (verde), Transf.+Tarjeta
- K2 Arqueo: Contado real ($), Notas, diferencia grande
  (verde "✓ Cuadra" / ámbar sobrante-faltante) + [Guardar cierre] [Imprimir]
- K3 Últimos cierres: fecha, ventas, esperado vs contado, badge diferencia
- K4 Sin permiso (vendedor): panel de acceso restringido con candado

---

## 4. PROTOTIPO (connections)
1. **Venta completa**: C1 → D1 (foto) → D2 → [Agregar] → C2 → C3 → C4
2. **Ingreso**: F1 → F2 → D1 → línea → F3 → éxito
3. **Alta producto**: E3 → D1 → D2/D3 → guardar → E1
4. **Anulación**: G2 → [Anular] → confirm → estado Cancelada
5. **Navegación**: BottomTabBar entre B1/C1/E1/F1/G1 + "Más" → H1/H2/I1/K1
6. **Cierre de caja**: "Más" → K1 → K2 (contado + guardar) → K3
7. **Transferencia**: F1 [Transferir] → F4 → origen/destino/producto → éxito → F1

Probar con app **Figma Mirror** en el celular real.

---

## 5. Handoff a código
- Nombres de tokens = clases Tailwind reales (`emerald-600`, `obsidian`, `rounded-2xl`) para copiar directo.
- Specs: spacing 4/8pt, radios arriba, mono para todo número.
- Assets: logo, icon-192/512, vacíos ilustrados → Export 2x/3x.
- Accesibilidad: contraste AA, targets ≥44pt, foco visible, labels en inputs.
