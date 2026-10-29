/**
 * PDF del ticket — ticket térmico de 80 mm, listo para imprimir o compartir.
 *
 * El ticket en pantalla (impresión del navegador) y este PDF usan los mismos
 * datos (`TicketData`), así que no pueden diferir entre sí.
 */

import { jsPDF } from 'jspdf';
import { loadBusiness } from './businessSettings';
import { paymentLabel } from './paymentMethods';
import { fmtMoney } from './format';
import { ticketNumberLabel, dispatchLabel, ticketSubtotal, type TicketData } from './ticketText';

const PAGE_W = 80;
const MARGIN = 6;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = [15, 23, 42] as const;
const MUTED = [100, 116, 139] as const;
const GREEN = [16, 185, 129] as const;

/**
 * Las fuentes estándar de jsPDF usan WinAnsi (Latin-1): los emojis y los
 * caracteres fuera de ese rango se imprimen como basura. Se eliminan.
 */
export function pdfSafeText(s: string): string {
  const out: string[] = [];
  for (const ch of s || '') {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0xff) { out.push(ch); continue; }        // Latin-1: se imprime bien
    if (cp === 0x2013 || cp === 0x2014) { out.push('-'); continue; }
    if (cp === 0x00a0) { out.push(' '); continue; }
    if (cp >= 0x1f000 && cp <= 0x1faff) continue;       // emojis
    if (cp >= 0x2600 && cp <= 0x27bf) continue;        // dingbats / símbolos
    if (cp >= 0x2b00 && cp <= 0x2bff) continue;        // flechas y flechas anchas
    if (cp >= 0xfe00 && cp <= 0xfe0f) continue;        // selectores de emoji
  }
  return out.join('');
}

function separator(doc: jsPDF, y: number): number {
  doc.setDrawColor(190, 200, 215);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([0.8, 0.8], 0);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  doc.setLineDashPattern([], 0);
  return y + 4;
}

/** Etiqueta a la izquierda, valor a la derecha (con ajuste de línea). */
function row(doc: jsPDF, y: number, label: string, value: string): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(pdfSafeText(label), MARGIN, y);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...INK);
  const lines: string[] = doc.splitTextToSize(pdfSafeText(value), CONTENT_W - 22);
  doc.text(lines, PAGE_W - MARGIN, y, { align: 'right' });
  return y + Math.max(4, lines.length * 3.6);
}

/** Dibuja el ticket y devuelve la coordenada Y final. */
function render(doc: jsPDF, data: TicketData): number {
  const biz = loadBusiness();
  let y = 9;

  // --- Cabecera ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(pdfSafeText((biz.name || 'TICKET').toUpperCase()), PAGE_W / 2, y, { align: 'center' });
  y += 5.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const head = [
    biz.address,
    biz.phone ? `Tel: ${biz.phone}` : '',
    biz.cuit ? `CUIT: ${biz.cuit}` : '',
  ].filter(Boolean);
  for (const line of head) {
    doc.text(pdfSafeText(line), PAGE_W / 2, y, { align: 'center' });
    y += 3.6;
  }

  y += 1.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...GREEN);
  doc.text('TICKET', PAGE_W / 2, y, { align: 'center' });
  y += 4.5;
  doc.setTextColor(...INK);
  doc.text(pdfSafeText(ticketNumberLabel(data)), PAGE_W / 2, y, { align: 'center' });
  y += 5;

  y = separator(doc, y);

  // --- Datos de la venta ---
  y = row(doc, y, 'FECHA', data.dateLabel);
  y = row(doc, y, 'CLIENTE', data.customerName || 'Cliente General');
  if (data.saleType === 'afip') {
    y = row(doc, y, 'CUIT/DNI', data.customerDoc || '-');
    y = row(doc, y, 'COND. IVA', data.customerIvaCond || 'CF');
  }
  y = row(doc, y, 'VENDEDOR', data.sellerName || 'Caja');
  y = row(doc, y, 'PAGO', paymentLabel(data.paymentMethod || 'cash'));
  y = row(doc, y, 'DESPACHO', dispatchLabel(data.dispatchType));
  for (const det of data.paymentDetails || []) {
    y = row(doc, y, det.split(':')[0].toUpperCase(), det.split(':').slice(1).join(':').trim());
  }
  if (data.notes) y = row(doc, y, 'NOTAS', data.notes);

  y = separator(doc, y);

  // --- Items ---
  if (data.items.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text('(Detalle de items no registrado)', MARGIN, y);
    y += 5;
  } else {
    for (const item of data.items) {
      const nameLines: string[] = doc.splitTextToSize(pdfSafeText(item.name), CONTENT_W - 20);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...INK);
      doc.text(nameLines, MARGIN, y);
      doc.text(pdfSafeText(fmtMoney(item.subtotal)), PAGE_W - MARGIN, y, { align: 'right' });
      y += nameLines.length * 3.8;

      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(
        pdfSafeText(`x${item.quantity} @ ${fmtMoney(item.unitPrice)}`),
        MARGIN + 2,
        y
      );
      y += 4;
    }
  }

  y = separator(doc, y);

  // --- Totales ---
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text('Subtotal', MARGIN, y);
  doc.text(pdfSafeText(fmtMoney(ticketSubtotal(data))), PAGE_W - MARGIN, y, { align: 'right' });
  y += 4;

  if ((data.discountAmount || 0) > 0) {
    doc.text(
      pdfSafeText(`Descuento${data.discountLabel ? ` (${data.discountLabel})` : ''}`),
      MARGIN,
      y
    );
    doc.text(pdfSafeText(`-${fmtMoney(data.discountAmount)}`), PAGE_W - MARGIN, y, { align: 'right' });
    y += 4;
  }

  if (data.dispatchType === 'delivery') {
    doc.text('Envio', MARGIN, y);
    doc.text(
      pdfSafeText((data.deliveryFee || 0) > 0 ? fmtMoney(data.deliveryFee) : 'BONIFICADO'),
      PAGE_W - MARGIN,
      y,
      { align: 'right' }
    );
    y += 4;
  }

  if (data.saleType === 'afip') {
    doc.text('Neto', MARGIN, y);
    doc.text(pdfSafeText(fmtMoney(data.netAmount ?? 0)), PAGE_W - MARGIN, y, { align: 'right' });
    y += 4;
    doc.text('IVA 21%', MARGIN, y);
    doc.text(pdfSafeText(fmtMoney(data.ivaAmount ?? 0)), PAGE_W - MARGIN, y, { align: 'right' });
    y += 4;
  }

  y += 1;
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text('TOTAL', MARGIN, y);
  doc.text(pdfSafeText(fmtMoney(data.totalAmount)), PAGE_W - MARGIN, y, { align: 'right' });
  y += 7;

  y = separator(doc, y);

  // --- Pie ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(pdfSafeText('¡Gracias por su compra!'), PAGE_W / 2, y, { align: 'center' });
  y += 4.5;

  if (biz.footer) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const footerLines: string[] = doc.splitTextToSize(pdfSafeText(biz.footer), CONTENT_W);
    doc.text(footerLines, PAGE_W / 2, y, { align: 'center' });
    y += footerLines.length * 3.4;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(pdfSafeText(`#${(data.saleId || '').slice(0, 8).toUpperCase()}`), PAGE_W / 2, y, {
    align: 'center',
  });
  y += 4;

  return y + 4;
}

/** Genera el PDF del ticket (una sola página, alto según el contenido). */
export function buildTicketPdf(data: TicketData): jsPDF {
  // Primera pasada con una página alta para medir el contenido real.
  const probe = new jsPDF({ unit: 'mm', format: [PAGE_W, 1000] });
  const endY = render(probe, data);

  const doc = new jsPDF({ unit: 'mm', format: [PAGE_W, Math.max(80, Math.ceil(endY))] });
  render(doc, data);
  return doc;
}

/** Bytes del PDF (síncrono: permite compartirlo dentro del gesto del usuario). */
export function ticketPdfBytes(data: TicketData): ArrayBuffer {
  return buildTicketPdf(data).output('arraybuffer');
}

/** Archivo PDF listo para compartir o descargar. */
export function ticketPdfFile(data: TicketData): File {
  const bytes = ticketPdfBytes(data);
  const name = data.receiptNumber
    ? `ticket-${data.receiptNumber}.pdf`
    : `ticket-${(data.saleId || 'venta').slice(0, 8).toUpperCase()}.pdf`;
  return new File([bytes], name, { type: 'application/pdf' });
}

/** Descarga el PDF del ticket. */
export function downloadTicketPdf(data: TicketData): void {
  const doc = buildTicketPdf(data);
  const name = data.receiptNumber
    ? `ticket-${data.receiptNumber}.pdf`
    : `ticket-${(data.saleId || 'venta').slice(0, 8).toUpperCase()}.pdf`;
  doc.save(name);
}
