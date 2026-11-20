export type GuideLevel = 'esencial' | 'basico' | 'avanzado';

export interface TourStep {
  selector: string;
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Vista en la que vive el elemento. Si se define, el tour navega antes de resaltarlo. */
  view?: string;
  level: GuideLevel;
}

export interface GuideSection {
  id: string;
  title: string;
  desc: string;
  level: GuideLevel;
  minutes: number;
}

/** Metadatos de las secciones que se muestran en el Centro de guías. */
export const GUIDE_SECTIONS: GuideSection[] = [
  { id: 'dashboard', title: 'Panel principal', desc: 'KPIs, rango de fechas, acciones rápidas, checklist, tendencias, pagos, top productos, rentabilidad, horarios y stock crítico.', level: 'esencial', minutes: 2 },
  { id: 'pos', title: 'Ventas', desc: 'Buscar, escanear, pesar, carrito, descuentos y cobrar.', level: 'esencial', minutes: 2 },
  { id: 'products', title: 'Productos y stock', desc: 'Alta, precios, márgenes, filtros, importación y exportación.', level: 'esencial', minutes: 2 },
  { id: 'intake', title: 'Ingreso de stock', desc: 'Compras a proveedores: borrador, escaneo y confirmación.', level: 'basico', minutes: 1 },
  { id: 'purchaseorders', title: 'Órdenes de compra', desc: 'Reposición sugerida por stock y ventas; borrador, envío y recepción.', level: 'basico', minutes: 2 },
  { id: 'history', title: 'Pedidos e historial', desc: 'Filtrar ventas, ver el detalle, reimprimir y anular.', level: 'basico', minutes: 1 },
  { id: 'activity', title: 'Mi actividad', desc: 'Tus ventas y movimientos de stock, solo lo que hiciste vos.', level: 'basico', minutes: 1 },
  { id: 'cashclose', title: 'Cierre de caja', desc: 'Fondo, retiros, gastos, conteo, diferencias e impresión del cierre.', level: 'avanzado', minutes: 2 },
  { id: 'reports', title: 'Reportes', desc: 'Rentabilidad, gastos del negocio, ganancia neta y exportación a PDF/Excel.', level: 'avanzado', minutes: 2 },
  { id: 'users', title: 'Usuarios y permisos', desc: 'Roles, permisos granulares y actividad del equipo.', level: 'avanzado', minutes: 1 },
  { id: 'settings', title: 'Configuración', desc: 'Datos del negocio, IVA, Mercado Pago, respaldos y ayuda.', level: 'avanzado', minutes: 1 },
];

/**
 * Secciones que el usuario tiene que pisar para completar el checklist de
 * inicio del dashboard. Se marcan como "visitadas" al entrar a ellas.
 */
export const CHECKLIST_SECTIONS: string[] = ['history', 'cashclose', 'reports'];

export const TOUR_STEPS: TourStep[] = [
  // ── Global (header / navegación) ────────────────────────────────
  {
    selector: '[data-tour="sidebar"]',
    title: 'Navegación principal',
    body: 'Desde acá accedés a todas las secciones. En celular se abre con el menú ☰ y tenés la barra inferior.',
    placement: 'right',
    level: 'esencial',
  },
  {
    selector: '[data-tour="search"]',
    title: 'Búsqueda global',
    body: 'Buscá productos, ventas o clientes desde cualquier pantalla. Atajo: Ctrl+K / ⌘K.',
    placement: 'bottom',
    level: 'esencial',
  },
  {
    selector: '[data-tour="notifications"]',
    title: 'Notificaciones',
    body: 'Alertas de stock bajo, vencimientos y ventas pendientes. Tocá una para ir directo a la sección.',
    placement: 'bottom',
    level: 'basico',
  },
  {
    selector: '[data-tour="help"]',
    title: 'Centro de guías',
    body: 'Este botón abre todas las guías por sección y te muestra tu progreso. Podés volver cuando quieras.',
    placement: 'bottom',
    level: 'esencial',
  },
  {
    selector: '[data-tour="theme"]',
    title: 'Modo claro / oscuro',
    body: 'Cambiá el tema según la luz del local. La app arranca en oscuro.',
    placement: 'bottom',
    level: 'esencial',
  },

  // ── Dashboard ───────────────────────────────────────────────────
  {
    selector: '[data-tour="dashboard-hero"]',
    title: 'Resumen operativo',
    body: 'Elegí Hoy, Semana, Mes o un rango personalizado. Todos los KPIs y gráficos se actualizan.',
    placement: 'bottom',
    view: 'dashboard',
    level: 'esencial',
  },
  {
    selector: '[data-tour="dashboard-kpis"]',
    title: 'Tus números del día',
    body: 'Ventas, ingresos, ganancia y stock crítico. El efectivo y el digital se separan automáticamente.',
    placement: 'bottom',
    view: 'dashboard',
    level: 'esencial',
  },
  {
    selector: '[data-tour="dashboard-quick"]',
    title: 'Acciones rápidas',
    body: 'Atajos a las tareas más usadas: vender, cargar productos, ver stock crítico y reportes.',
    placement: 'top',
    view: 'dashboard',
    level: 'esencial',
  },
  {
    selector: '[data-tour="dashboard-checklist"]',
    title: 'Checklist de inicio',
    body: 'Tachá los primeros pasos para dejar la dietética funcionando. El progreso se guarda solo.',
    placement: 'top',
    view: 'dashboard',
    level: 'esencial',
  },
  {
    selector: '[data-tour="dashboard-charts"]',
    title: 'Tendencias y categorías',
    body: 'Mirá cómo evolucionan las ventas por hora o por día. Más abajo, la rentabilidad por categoría te dice qué deja más margen.',
    placement: 'top',
    view: 'dashboard',
    level: 'basico',
  },
  {
    selector: '[data-tour="dashboard-payments"]',
    title: 'Distribución de Pagos',
    body: 'Mirá qué porcentaje de las ventas se cobra en efectivo, tarjeta, transferencia o Mercado Pago. Útil para decidir si conviene ofrecer descuentos por pago en efectivo.',
    placement: 'top',
    view: 'dashboard',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="dashboard-topsellers"]',
    title: 'Top 10 Productos Estrella',
    body: 'Los productos que más facturan o más se venden. Tocá uno para ver su detalle y ajustar precio o stock. Ideal para armar promos o reposición.',
    placement: 'top',
    view: 'dashboard',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="dashboard-categories"]',
    title: 'Rentabilidad por Categoría',
    body: 'Qué categorías dejan más margen. Si una categoría vende mucho pero deja poco margen, conviene revisar precios o costos.',
    placement: 'top',
    view: 'dashboard',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="dashboard-hourly"]',
    title: 'Horarios Pico',
    body: 'En qué franjas horarias se concentra la venta. Útil para planificar turnos de personal y promociones por horario.',
    placement: 'top',
    view: 'dashboard',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="dashboard-stock"]',
    title: 'Stock Crítico',
    body: 'Cantidad de productos por debajo del mínimo. Tocá para ver cuáles son y reponerlos. Se actualiza en tiempo real.',
    placement: 'top',
    view: 'dashboard',
    level: 'avanzado',
  },

  // ── POS ─────────────────────────────────────────────────────────

  {
    selector: '[data-tour="pos-search"]',
    title: 'Buscar o escanear',
    body: 'Escribí el nombre o el código de barras + Enter. El botón de cámara abre el escáner y F8 también.',
    placement: 'bottom',
    view: 'pos',
    level: 'esencial',
  },
  {
    selector: '[data-tour="pos-categories"]',
    title: 'Filtrar por categoría',
    body: 'Elegí "Todas" o una categoría para encontrar productos más rápido.',
    placement: 'bottom',
    view: 'pos',
    level: 'esencial',
  },
  {
    selector: '[data-tour="pos-products"]',
    title: 'Grilla de productos',
    body: 'Tocá un producto para agregarlo. Los que se venden por kilo abren la balanza.',
    placement: 'top',
    view: 'pos',
    level: 'esencial',
  },
  {
    selector: '[data-tour="pos-cart"]',
    title: 'Carrito',
    body: 'Ajustá cantidades, aplicá descuentos por ítem y elegí cliente, pago y despacho.',
    placement: 'left',
    view: 'pos',
    level: 'esencial',
  },
  {
    selector: '[data-tour="pos-payment"]',
    title: 'Medios de pago',
    body: 'Elegí efectivo, transferencia (banco y comprobante), tarjeta, link de Mercado Pago o terminal Point. El comprobante puede ser interno o ARCA.',
    placement: 'top',
    view: 'pos',
    level: 'esencial',
  },
  {
    selector: '[data-tour="pos-totals"]',
    title: 'Cobrar',
    body: 'Revisá el total y presioná COBRAR (F12). Elegí efectivo, transferencia (banco y comprobante), tarjeta, link de Mercado Pago o terminal Point. Sin conexión, la venta se guarda y se sincroniza sola.',
    placement: 'top',
    view: 'pos',
    level: 'esencial',
  },

  // ── Productos ───────────────────────────────────────────────────
  {
    selector: '[data-tour="products-toolbar"]',
    title: 'Buscador y vista',
    body: 'Buscá por nombre, código de barras o categoría. La densidad y los filtros guardados están en la barra de abajo.',
    placement: 'bottom',
    view: 'products',
    level: 'esencial',
  },
  {
    selector: '[data-tour="products-new"]',
    title: 'Nuevo producto',
    body: 'Cargá nombre, categoría, precios y stock. Podés escanear el código para no escribirlo.',
    placement: 'bottom',
    view: 'products',
    level: 'esencial',
  },
  {
    selector: '[data-tour="products-filters"]',
    title: 'Filtros inteligentes',
    body: 'Filtrá por categoría, stock bajo, vencimientos o margen. Los filtros se combinan.',
    placement: 'bottom',
    view: 'products',
    level: 'basico',
  },
  {
    selector: '[data-tour="products-table"]',
    title: 'Tabla de productos',
    body: 'Tocá una fila para ver el detalle, editar precios o ajustar stock sin salir de la vista.',
    placement: 'top',
    view: 'products',
    level: 'basico',
  },

  // ── Ingreso de stock ────────────────────────────────────────────
  {
    selector: '[data-tour="intake-new"]',
    title: 'Nuevo ingreso',
    body: 'Cargá la compra a un proveedor. Podés guardarla como borrador y confirmarla después.',
    placement: 'bottom',
    view: 'intake',
    level: 'basico',
  },
  {
    selector: '[data-tour="intake-list"]',
    title: 'Ingresos cargados',
    body: 'Tocá un ingreso para ver ítems, costos y lotes. Confirmalo para que sume stock.',
    placement: 'top',
    view: 'intake',
    level: 'basico',
  },

  // ── Órdenes de compra ───────────────────────────────────────────
  {
    selector: '[data-tour="purchaseorders-header"]',
    title: 'Generar orden de compra',
    body: 'La app calcula qué reponer según el stock objetivo y la demanda de ventas. Se crea una orden por proveedor.',
    placement: 'bottom',
    view: 'purchaseorders',
    level: 'basico',
  },
  {
    selector: '[data-tour="purchaseorders-kpis"]',
    title: 'Estado de tus compras',
    body: 'Borradores, enviadas, recibidas y el valor pendiente de entrega, todo en un vistazo.',
    placement: 'bottom',
    view: 'purchaseorders',
    level: 'basico',
  },
  {
    selector: '[data-tour="purchaseorders-filters"]',
    title: 'Filtrar por estado',
    body: 'Mirá solo borradores, enviadas, recibidas o canceladas para seguir cada compra.',
    placement: 'bottom',
    view: 'purchaseorders',
    level: 'basico',
  },
  {
    selector: '[data-tour="purchaseorders-list"]',
    title: 'Recibir y comparar costos',
    body: 'Al recibir, confirmá lo que llegó: la app compara el costo estimado con el real y suma el stock.',
    placement: 'top',
    view: 'purchaseorders',
    level: 'basico',
  },

  // ── Historial ───────────────────────────────────────────────────
  {
    selector: '[data-tour="history-kpis"]',
    title: 'Resumen del período',
    body: 'Total vendido, tickets, ganancia y ticket promedio del rango elegido.',
    placement: 'bottom',
    view: 'history',
    level: 'basico',
  },
  {
    selector: '[data-tour="history-filters"]',
    title: 'Filtros de ventas',
    body: 'Filtrá por fecha, pago, estado o vendedor. También podés buscar por ticket.',
    placement: 'bottom',
    view: 'history',
    level: 'basico',
  },
  {
    selector: '[data-tour="history-table"]',
    title: 'Detalle y acciones',
    body: 'Expandí una venta para ver ítems, reenviar el comprobante o anular (si tenés permiso).',
    placement: 'top',
    view: 'history',
    level: 'basico',
  },

  // ── Mi actividad ────────────────────────────────────────────────
  {
    selector: '[data-tour="activity-sales"]',
    title: 'Tus ventas',
    body: 'Solo las ventas que registraste vos, con fecha, medio de pago y total. Ideal para controlar tu turno.',
    placement: 'bottom',
    view: 'activity',
    level: 'basico',
  },
  {
    selector: '[data-tour="activity-moves"]',
    title: 'Tus movimientos de stock',
    body: 'Altas, ajustes y transferencias que hiciste, con el stock antes y después de cada movimiento.',
    placement: 'top',
    view: 'activity',
    level: 'basico',
  },

  // ── Cierre de caja ──────────────────────────────────────────────
  {
    selector: '[data-tour="cashclose-summary"]',
    title: 'Resumen del día',
    body: 'Ventas, efectivo esperado y medios de pago del día que estás cerrando.',
    placement: 'bottom',
    view: 'cashclose',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="cashclose-movements"]',
    title: 'Efectivo del día',
    body: 'Cargá el fondo inicial, ingresos y retiros. Los gastos en efectivo del reporte se descuentan solos y ves el esperado antes de guardar.',
    placement: 'top',
    view: 'cashclose',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="cashclose-count"]',
    title: 'Conteo y diferencia',
    body: 'Ingresá el efectivo contado (o usá el esperado). La app calcula sobrante o faltante al instante y avisa si el cierre quedó viejo por ventas posteriores.',
    placement: 'top',
    view: 'cashclose',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="cashclose-history"]',
    title: 'Cierres anteriores',
    body: 'Consultá cierres pasados y detectá diferencias recurrentes. Si guardaste antes de tiempo, podés actualizar el cierre del mismo día.',
    placement: 'top',
    view: 'cashclose',
    level: 'avanzado',
  },

  // ── Reportes ────────────────────────────────────────────────────
  {
    selector: '[data-tour="reports-kpis"]',
    title: 'Métricas del negocio',
    body: 'Tickets, facturación, ganancia bruta, gastos, ganancia neta y margen del período, con la variación contra el período anterior.',
    placement: 'bottom',
    view: 'reports',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="reports-range"]',
    title: 'Rango de análisis',
    body: 'Cambiá el período (día, semana o mes) y todos los números se recalculan. Ideal para cerrar el mes.',
    placement: 'bottom',
    view: 'reports',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="reports-expenses"]',
    title: 'Gastos del negocio',
    body: 'Cargá alquiler, servicios o sueldos con su categoría y medio de pago. Se restan de la ganancia bruta para darte la ganancia neta real.',
    placement: 'top',
    view: 'reports',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="reports-export"]',
    title: 'Exportar',
    body: 'Descargá el reporte en PDF o Excel para compartirlo o archivarlo.',
    placement: 'bottom',
    view: 'reports',
    level: 'avanzado',
  },

  // ── Usuarios ────────────────────────────────────────────────────
  {
    selector: '[data-tour="users-list"]',
    title: 'Equipo',
    body: 'Cada usuario tiene un rol y permisos. Tocá los chips de permisos para ver la matriz completa y la actividad del equipo.',
    placement: 'top',
    view: 'users',
    level: 'avanzado',
  },

  // ── Configuración ───────────────────────────────────────────────
  {
    selector: '[data-tour="settings-business"]',
    title: 'Datos del negocio',
    body: 'Nombre, dirección, teléfono y datos que salen impresos en el ticket.',
    placement: 'bottom',
    view: 'settings',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="settings-mp"]',
    title: 'Mercado Pago',
    body: 'Configurá el modo prueba o producción para cobrar con QR, link de pago y terminal Point.',
    placement: 'bottom',
    view: 'settings',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="settings-point"]',
    title: 'Terminal Point',
    body: 'Conectá una terminal Mercado Pago Point. Al cobrar, el POS envía la orden y la venta queda pendiente hasta que MP la apruebe.',
    placement: 'top',
    view: 'settings',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="settings-backup"]',
    title: 'Respaldos',
    body: 'Descargá productos y ventas en CSV. Hacelo seguido: es tu copia de seguridad.',
    placement: 'top',
    view: 'settings',
    level: 'avanzado',
  },
  {
    selector: '[data-tour="settings-help"]',
    title: 'Volver a aprender',
    body: 'Desde acá podés repetir el recorrido completo o abrir una guía puntual.',
    placement: 'top',
    view: 'settings',
    level: 'esencial',
  },
];

export type GuideId = 'inicio' | 'completa' | string;

/** Devuelve los pasos que corresponden a una guía. */
export function guideSteps(guideId: GuideId): TourStep[] {
  if (guideId === 'completa') return TOUR_STEPS;
  if (guideId === 'inicio') return TOUR_STEPS.filter((s) => s.level === 'esencial');
  return TOUR_STEPS.filter((s) => s.view === guideId);
}

export function guideTitle(guideId: GuideId): string {
  if (guideId === 'completa') return 'Guía completa';
  if (guideId === 'inicio') return 'Primeros pasos';
  return GUIDE_SECTIONS.find((s) => s.id === guideId)?.title ?? 'Guía';
}
