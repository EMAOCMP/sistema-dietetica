import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTicketPdf, pdfSafeText, ticketPdfFile, ticketPdfBytes } from '../ticketPdf';
import type { TicketData } from '../ticketText';

const store: Record<string, string> = {};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.mocked(localStorage.getItem).mockImplementation((k: string) => (k in store ? store[k] : null));
  vi.mocked(localStorage.setItem).mockImplementation((k: string, v: string) => { store[k] = String(v); });
  store['dv-business'] = JSON.stringify({
    name: 'DIETETICA VISHAL',
    address: 'Av. Siempreviva 742',
    phone: '3435551234',
    cuit: '30-12345678-9',
    footer: 'Dietética Vishal • Lo natural se siente todos los días 🌿',
    myWhatsapp: '',
  });
});

const base: TicketData = {
  saleId: 'abcdef1234567890',
  receiptNumber: '0001-00000018',
  dateLabel: '23/10/2026, 12:36:25',
  customerName: 'Cliente General',
  saleType: 'internal',
  paymentMethod: 'cash',
  dispatchType: 'pickup',
  items: [{ name: 'Harina Avena x 1kg', quantity: 2, unitPrice: 1719.25, subtotal: 3438.5 }],
  subtotal: 3438.5,
  totalAmount: 3438.5,
  sellerName: 'Administrador',
};

describe('pdfSafeText', () => {
  it('quita los emojis (no existen en las fuentes estándar de PDF)', () => {
    expect(pdfSafeText('¡Gracias! 🌱')).toBe('¡Gracias! ');
  });

  it('conserva los acentos y la eñe', () => {
    expect(pdfSafeText('Ñandú áéíóú')).toBe('Ñandú áéíóú');
  });

  it('reemplaza las rayas tipográficas', () => {
    expect(pdfSafeText('a–b—c')).toBe('a-b-c');
  });
});

describe('buildTicketPdf', () => {
  it('genera un PDF válido', () => {
    const doc = buildTicketPdf(base);
    const bytes = doc.output('arraybuffer');
    const header = new TextDecoder('latin1').decode(new Uint8Array(bytes).slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('usa el ancho de ticket térmico de 80 mm', () => {
    const doc = buildTicketPdf(base);
    expect(doc.internal.pageSize.getWidth()).toBe(80);
  });

  it('el alto crece con la cantidad de ítems', () => {
    const short = buildTicketPdf(base);
    const tall = buildTicketPdf({
      ...base,
      items: Array.from({ length: 12 }, (_, i) => ({
        name: `Producto ${i}`,
        quantity: 1,
        unitPrice: 100,
        subtotal: 100,
      })),
    });
    expect(tall.internal.pageSize.getHeight()).toBeGreaterThan(short.internal.pageSize.getHeight());
  });

  it('no se rompe con una venta sin ítems', () => {
    const doc = buildTicketPdf({ ...base, items: [] });
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(500);
  });
});

describe('ticketPdfFile', () => {
  it('genera un File con el nombre del ticket', () => {
    const file = ticketPdfFile(base);
    expect(file.name).toBe('ticket-0001-00000018.pdf');
    expect(file.type).toBe('application/pdf');
    expect(file.size).toBeGreaterThan(500);
  });

  it('usa el id de la venta cuando no hay correlativo', () => {
    const file = ticketPdfFile({ ...base, receiptNumber: null });
    expect(file.name).toBe('ticket-ABCDEF12.pdf');
  });
});

describe('ticketPdfBytes', () => {
  it('devuelve los bytes del PDF', () => {
    const bytes = ticketPdfBytes(base);
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
