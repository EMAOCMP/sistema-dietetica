# Estructura del Proyecto - Parte 1: Frontend (React + Vite + Tailwind)

Este documento detalla la estructura y organización del código fuente del frontend ubicado en `src/`.

## 1. Vistas Principales (`src/components/views/`)
- **`DashboardView.tsx`**: Panel principal con métricas en tiempo real, resumen de ventas, gráfico de ritmo de la meta diaria y accesos rápidos.
- **`POSView.tsx`**: Caja / Punto de Venta (POS) rápido para cobros, carrito, escaneo de códigos de barras, medios de pago (efectivo, MP, transferencia, fiado) y modo offline.
- **`ProductsView.tsx`**: Gestión de inventario, stock por ubicaciones (local/depósito), precios, lotes, vencimientos y baja de productos.
- **`HistoryView.tsx`**: Historial de tickets y pedidos, búsqueda, filtros y cancelación de ventas con reversión de stock.
- **`ReportsView.tsx`**: Reportes de ganancias (diario, semanal, mensual), comparación Δ% vs. período anterior, ganancia por vendedor, gastos del negocio y ganancia neta. Permite exportar a CSV y PDF.
- **`CashCloseView.tsx`**: Cierre de caja diario/por turno con desglose de medios de pago, diferencias y arqueo.
- **`UsersView.tsx`**: Gestión de usuarios, roles (admin, supervisor, cajero) y registro de actividad de empleados.
- **`SettingsView.tsx`**: Parámetros de la empresa (IVA, punto de venta, margen objetivo, horario de la meta diaria) y gestión de ubicaciones de stock.
- **`MyActivityView.tsx`**: Actividad personal del usuario logueado.

## 2. Componentes UI, Layout y Gráficos (`src/components/`)
- **`ui/`**: Componentes reutilizables de interfaz (SelectMenu para desplegables modernos con modo oscuro, DatePicker para rangos de fecha, CommandPalette para búsqueda global, ActionDropdown, ModalShell, NotificationsPanel, OfflineIndicator, ScaleModal).
- **`layout/`**: Navbar lateral/superior, MobileTabBar para navegación móvil inferior, componentes de Autenticación (Login, NewPassword).
- **`charts/`**: Gráficos analíticos (SalesTrendChart, CategoryProfits, PaymentDonut, RevenueBreakdown, HourlyDemand, StockBreakdown).

## 3. Lógica y Servicios (`src/lib/`)
- **`supabase.ts`**: Cliente oficial de Supabase.
- **`salesService.ts` & `cartService.ts`**: Lógica de transacciones, creación de ventas (RPC), manejo de carritos, descuentos y persistencia.
- **`syncEngine.ts` & `offlineDB.ts`**: Motor de sincronización offline (IndexedDB) para ventas guardadas sin conexión.
- **`reportAggregation.ts` & `reportPdf.ts`**: Agregación de datos por día/semana/mes para reportes y generación de PDF con jsPDF + autoTable.
- **`metaSchedule.ts`**: Gestión del horario configurable de la meta de ventas.
- **`tax.ts`, `format.ts`, `share.ts`, `whatsapp.ts`, `exportCsv.ts`, `exportXlsx.ts`, `ticketPdf.ts`, `ticketText.ts`, `receipt.ts`, `productLookup.ts`, `productBarcodes.ts`, `permissions.ts`, `paymentMethods.ts`, `onboardingProgress.ts`, `businessSettings.ts`, `mercadoPagoService.ts`**: Utilidades de negocio, formateo, tickets, impresión y exportación.

## 4. Módulos Especializados (`src/features/`)
- **`scanner/`**: Sistema avanzado de escaneo de códigos de barras (hardware USB, cámara en vivo, normalización de códigos EAN/balanza, guardas contra doble escaneo y resolución contra catálogo).
- **`onboarding/`**: Sistema de guías contextuales, tooltips y tour de bienvenida para nuevos usuarios.

## 5. Hooks y Tipos
- **`src/hooks/`**: Custom hooks como `useOnlineStatus`.
- **`src/types.ts`**: Definiciones TypeScript globales de modelos (Product, Sale, Profile, etc.).
- **`src/test/setup.ts`**: Configuración de Vitest (entorno jsdom).
