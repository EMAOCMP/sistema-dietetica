/**
 * PDF del historial de ventas (listado del filtro actual).
 *
 * A diferencia de `reportPdf` (que arma un resumen operativo del panel), este
 * documento es el detalle ticket por ticket para imprimir o archivar.
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmtMoney } from './format';

export interface HistoryPdfRow {
  ticket: string;
  fecha: string;
  cliente: string;
  vendedor: string;
  pago: string;
  estado: string;
  total: number;
  ganancia?: number;
  anulada: boolean;
}

export interface HistoryPdfTotals {
  revenue: number;
  profit?: number;
  count: number;
  cancelled: number;
  cancelledAmount: number;
}

function buildHistorialDoc(periodo: string, rows: HistoryPdfRow[], totals: HistoryPdfTotals) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();

  // Encabezado
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('DIETÉTICA VISHAL', 14, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(100, 116, 139);
  doc.text(`Historial de ventas — ${periodo}`, 14, 22);
  doc.setFontSize(9);
  doc.text(`Generado: ${new Date().toLocaleString('es-AR')}`, pageW - 14, 22, { align: 'right' });

  // Resumen
  const resumen: string[][] = [
    ['Tickets', String(totals.count)],
    ['Facturado', fmtMoney(totals.revenue)],
    ...(totals.profit !== undefined ? [['Ganancia', fmtMoney(totals.profit)]] : []),
    ['Anuladas', `${totals.cancelled}${totals.cancelled > 0 ? ` (${fmtMoney(totals.cancelledAmount)})` : ''}`],
  ];
  autoTable(doc, {
    startY: 27,
    head: [resumen.map((r) => r[0])],
    body: [resumen.map((r) => r[1])],
    margin: { left: 14, right: 14 },
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], fontSize: 8, halign: 'center' },
    bodyStyles: { fontSize: 10, fontStyle: 'bold', halign: 'center' },
  });

  const hasProfit = rows.some((r) => r.ganancia !== undefined);
  const head = ['Ticket', 'Fecha', 'Cliente', 'Vendedor', 'Pago', 'Estado', 'Total'];
  if (hasProfit) head.push('Ganancia');

  const cancelledRows = new Set(rows.map((r, i) => (r.anulada ? i : -1)).filter((i) => i >= 0));

  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 6,
    head: [head],
    body: rows.map((r) => {
      const row = [r.ticket, r.fecha, r.cliente || 'Consumidor final', r.vendedor, r.pago, r.estado, fmtMoney(r.total)];
      if (hasProfit) row.push(fmtMoney(r.ganancia ?? 0));
      return row;
    }),
    margin: { left: 14, right: 14, bottom: 18 },
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [30, 41, 59], fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 34 },
      2: { cellWidth: 55 },
      5: { cellWidth: 22 },
      6: { cellWidth: 26, halign: 'right' },
      7: { cellWidth: 26, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && cancelledRows.has(data.row.index)) {
        data.cell.styles.textColor = [185, 28, 28];
        data.cell.styles.fillColor = [254, 242, 242];
      }
    },
  });

  // Pie con numeración
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('Dietética Vishal · comprobantes internos', 14, doc.internal.pageSize.getHeight() - 8);
    doc.text(`Página ${i} de ${pages}`, pageW - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
  }

  return doc;
}

function stampFile(ext: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `historial-ventas-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

/** Descarga el PDF del listado. */
export function exportHistorialPdf(periodo: string, rows: HistoryPdfRow[], totals: HistoryPdfTotals) {
  buildHistorialDoc(periodo, rows, totals).save(stampFile('pdf'));
}

/** Abre el PDF en una pestaña nueva con el diálogo de impresión listo. */
export function printHistorialPdf(periodo: string, rows: HistoryPdfRow[], totals: HistoryPdfTotals) {
  const doc = buildHistorialDoc(periodo, rows, totals);
  doc.autoPrint();
  const url = doc.output('bloburl');
  const win = window.open(url, '_blank');
  if (!win) {
    // Si el navegador bloquea la pestaña, al menos que se descargue.
    doc.save(stampFile('pdf'));
  }
}
