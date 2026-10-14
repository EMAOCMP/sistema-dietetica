import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ReportSale {
  created_at: string;
  customer_name: string;
  total_amount: number;
  payment_method?: string;
}

export interface ReportProduct {
  name: string;
  category: string;
  totalQty: number;
  totalRevenue: number;
}

export interface ReportCategory {
  category: string;
  revenue: number;
  profit: number;
}

export interface ReportStockItem {
  name: string;
  stock_quantity: number;
  min_stock: number;
  suggested: number;
  cost: number;
}

export interface DashboardReport {
  periodo: string;
  salesCount: number;
  revenue: number;
  profit: number;
  avgTicket: number;
  cashTotal: number;
  transferTotal: number;
  cardTotal: number;
  bestSellers: ReportProduct[];
  categoryProfits: ReportCategory[];
  sales: ReportSale[];
  lowStock: ReportStockItem[];
}

const fmt$ = (n: number) =>
  '$' + Math.round(n).toLocaleString('es-AR');

const pagoLabel = (m?: string) =>
  m === 'transfer' ? 'Transferencia' : m === 'card' ? 'Tarjeta' : 'Efectivo';

export function downloadDashboardPdf(r: DashboardReport) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 14;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('DIETÉTICA VISHAL', 14, y);
  doc.setFontSize(11);
  doc.setTextColor(100, 116, 139);
  doc.text(`Resumen Operativo — ${r.periodo}`, 14, y + 7);
  doc.setFontSize(9);
  doc.text(`Generado: ${new Date().toLocaleString('es-AR')}`, pageW - 14, y + 7, { align: 'right' });
  y += 13;

  // KPIs
  autoTable(doc, {
    startY: y,
    head: [['Ventas', 'Ingresos', 'Ganancia', 'Ticket prom.']],
    body: [[
      String(r.salesCount),
      fmt$(r.revenue),
      fmt$(r.profit),
      fmt$(r.avgTicket),
    ]],
    margin: { left: 14, right: 14, bottom: 20 },
    theme: 'grid',
    headStyles: { fillColor: [16, 185, 129], fontSize: 9 },
    bodyStyles: { fontSize: 11, fontStyle: 'bold' },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // Pagos
  const payTotal = r.cashTotal + r.transferTotal + r.cardTotal || 1;
  autoTable(doc, {
    startY: y,
    head: [['Medio de pago', 'Monto', '%']],
    body: [
      ['Efectivo', fmt$(r.cashTotal), `${((r.cashTotal / payTotal) * 100).toFixed(0)}%`],
      ['Transferencia', fmt$(r.transferTotal), `${((r.transferTotal / payTotal) * 100).toFixed(0)}%`],
      ['Tarjeta', fmt$(r.cardTotal), `${((r.cardTotal / payTotal) * 100).toFixed(0)}%`],
    ],
    margin: { left: 14, right: 14, bottom: 20 },
    theme: 'striped',
    headStyles: { fillColor: [14, 165, 233], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // Top productos
  if (r.bestSellers.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['#', 'Producto', 'Cant.', 'Revenue']],
      body: r.bestSellers.slice(0, 10).map((p, i) => [
        String(i + 1), `${p.name} (${p.category})`,
        String(Math.round(p.totalQty)), fmt$(p.totalRevenue),
      ]),
      margin: { left: 14, right: 14, bottom: 20 },
    theme: 'striped',
      headStyles: { fillColor: [245, 158, 11], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Categorías
  if (r.categoryProfits.length > 0) {
    if (y > 240) { doc.addPage(); y = 14; }
    autoTable(doc, {
      startY: y,
      head: [['Categoría', 'Facturación', 'Ganancia', 'Margen']],
      body: r.categoryProfits.map((c) => [
        c.category, fmt$(c.revenue), fmt$(c.profit),
        c.revenue > 0 ? `${((c.profit / c.revenue) * 100).toFixed(1)}%` : '0%',
      ]),
      margin: { left: 14, right: 14, bottom: 20 },
    theme: 'striped',
      headStyles: { fillColor: [13, 148, 136], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Stock crítico
  if (r.lowStock.length > 0) {
    if (y > 240) { doc.addPage(); y = 14; }
    autoTable(doc, {
      startY: y,
      head: [['Producto', 'Stock', 'Mín', 'Sugerido', 'Costo est.']],
      body: r.lowStock.map((p) => [
        p.name, String(p.stock_quantity), String(p.min_stock),
        String(p.suggested), fmt$(p.cost),
      ]),
      margin: { left: 14, right: 14, bottom: 20 },
    theme: 'striped',
      headStyles: { fillColor: [239, 68, 68], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Ventas (últimas 30)
  if (r.sales.length > 0) {
    if (y > 240) { doc.addPage(); y = 14; }
    autoTable(doc, {
      startY: y,
      head: [['Fecha', 'Cliente', 'Pago', 'Total']],
      body: r.sales.slice(0, 30).map((s) => [
        new Date(s.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
        s.customer_name || 'Cliente General',
        pagoLabel(s.payment_method),
        fmt$(Number(s.total_amount)),
      ]),
      margin: { left: 14, right: 14, bottom: 20 },
    theme: 'striped',
      headStyles: { fillColor: [71, 85, 105], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
    });
  }

  // Footer con páginas
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Página ${i} de ${pages}`, pageW - 14, 290, { align: 'right' });
  }

  doc.save(`reporte-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export interface ReportsPeriodRow {
  label: string;
  sublabel?: string;
  tickets: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  marginPct: number;
}

export interface ReportsSellerRow {
  name: string;
  tickets: number;
  revenue: number;
  profit: number;
}

export function downloadReportsPdf(args: {
  periodo: string;
  rows: ReportsPeriodRow[];
  totals: { tickets: number; revenue: number; grossProfit: number; expenses: number; netProfit: number };
  sellers: ReportsSellerRow[];
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 14;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('DIETÉTICA VISHAL', 14, y);
  doc.setFontSize(11);
  doc.setTextColor(100, 116, 139);
  doc.text(`Reporte de Ganancias — ${args.periodo}`, 14, y + 7);
  doc.setFontSize(9);
  doc.text(`Generado: ${new Date().toLocaleString('es-AR')}`, pageW - 14, y + 7, { align: 'right' });
  y += 13;

  const t = args.totals;
  autoTable(doc, {
    startY: y,
    head: [['Tickets', 'Facturación', 'Ganancia bruta', 'Gastos', 'Ganancia neta', 'Margen neto']],
    body: [[
      String(t.tickets),
      fmt$(t.revenue),
      fmt$(t.grossProfit),
      fmt$(t.expenses),
      fmt$(t.netProfit),
      t.revenue > 0 ? `${((t.netProfit / t.revenue) * 100).toFixed(1)}%` : '0%',
    ]],
    margin: { left: 14, right: 14, bottom: 20 },
    theme: 'grid',
    headStyles: { fillColor: [16, 185, 129], fontSize: 8 },
    bodyStyles: { fontSize: 9, fontStyle: 'bold' },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  const visible = args.rows.filter((r) => r.tickets > 0 || r.expenses > 0);
  autoTable(doc, {
    startY: y,
    head: [['Período', 'Tickets', 'Facturación', 'Costo', 'G. bruta', 'Gastos', 'G. neta', 'Margen']],
    body: visible.map((r) => [
      r.sublabel ? `${r.label} (${r.sublabel})` : r.label,
      String(r.tickets),
      fmt$(r.revenue),
      fmt$(r.cost),
      fmt$(r.grossProfit),
      fmt$(r.expenses),
      fmt$(r.netProfit),
      `${r.marginPct.toFixed(1)}%`,
    ]),
    margin: { left: 14, right: 14, bottom: 20 },
    theme: 'striped',
    headStyles: { fillColor: [14, 165, 233], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
  });

  if (args.sellers.length > 0) {
    const pages = doc.getNumberOfPages();
    doc.setPage(pages);
    const lastY = (doc as any).lastAutoTable?.finalY || 250;
    if (lastY > 230) { doc.addPage(); y = 14; } else { y = lastY + 8; }
    autoTable(doc, {
      startY: y,
      head: [['Vendedor', 'Tickets', 'Facturación', 'Ganancia', 'Margen']],
      body: args.sellers.map((s) => [
        s.name,
        String(s.tickets),
        fmt$(s.revenue),
        fmt$(s.profit),
        s.revenue > 0 ? `${((s.profit / s.revenue) * 100).toFixed(1)}%` : '0%',
      ]),
      margin: { left: 14, right: 14, bottom: 20 },
      theme: 'striped',
      headStyles: { fillColor: [13, 148, 136], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Página ${i} de ${pages}`, pageW - 14, 290, { align: 'right' });
  }

  doc.save(`reporte-ganancias-${new Date().toISOString().slice(0, 10)}.pdf`);
}
