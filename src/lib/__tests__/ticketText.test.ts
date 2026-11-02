import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTicketText, ticketNumberLabel, ticketSubtotal, type TicketData } from '../ticketText';

// El setup global mockea localStorage con vi.fn(); conectamos un store real.
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
    footer: 'Dietética Vishal',
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

describe('ticketNumberLabel', () => {
  it('usa el correlativo cuando existe', () => {
    expect(ticketNumberLabel(base)).toBe('N° 0001-00000018');
  });
  it('usa el id de la venta cuando no hay correlativo', () => {
    expect(ticketNumberLabel({ ...base, receiptNumber: null })).toBe('Ticket #ABCDEF12');
  });
});

describe('ticketSubtotal', () => {
  it('usa el subtotal informado', () => {
    expect(ticketSubtotal(base)).toBe(3438.5);
  });
  it('lo calcula con los ítems si no viene informado', () => {
    const { subtotal: _subtotal, ...rest } = base;
    expect(ticketSubtotal(rest as TicketData)).toBe(3438.5);
  });
});

describe('buildTicketText', () => {
  it('incluye los datos del negocio y de la venta', () => {
    const text = buildTicketText(base);
    expect(text).toContain('DIETETICA VISHAL');
    expect(text).toContain('Av. Siempreviva 742');
    expect(text).toContain('Tel: 3435551234');
    expect(text).toContain('CUIT: 30-12345678-9');
    expect(text).toContain('Cliente: Cliente General');
    expect(text).toContain('Fecha: 23/10/2026, 12:36:25');
    expect(text).toContain('Pago: Efectivo');
    expect(text).toContain('Despacho: Retira');
    expect(text).toContain('Vendedor: Administrador');
  });

  it('incluye los ítems y el total', () => {
    const text = buildTicketText(base);
    expect(text).toContain('- Harina Avena x 1kg x2 - $3.438,50');
    expect(text).toContain('Subtotal: $3.438,50');
    expect(text).toContain('*TOTAL: $3.438,50*');
  });

  it('marca negrita con asteriscos (WhatsApp lo interpreta)', () => {
    const text = buildTicketText(base);
    expect(text.split('\n')[0]).toBe('*DIETETICA VISHAL - N° 0001-00000018*');
  });

  it('agrega descuento, envío y datos fiscales cuando corresponde', () => {
    const text = buildTicketText({
      ...base,
      saleType: 'afip',
      customerDoc: '20123456789',
      customerIvaCond: 'RI',
      discountLabel: '10%',
      discountAmount: 100,
      dispatchType: 'delivery',
      deliveryFee: 500,
      netAmount: 3000,
      ivaAmount: 630,
      totalAmount: 3838.5,
    });
    expect(text).toContain('CUIT/DNI: 20123456789');
    expect(text).toContain('Cond. IVA: RI');
    expect(text).toContain('Descuento (10%): -$100,00');
    expect(text).toContain('Envio: +$500,00');
    expect(text).toContain('Neto: $3.000,00');
    expect(text).toContain('IVA 21%: $630,00');
  });

  it('marca el envío bonificado', () => {
    const text = buildTicketText({ ...base, dispatchType: 'delivery', deliveryFee: 0 });
    expect(text).toContain('Envio: BONIFICADO');
  });

  it('avisa cuando la venta no tiene ítems registrados', () => {
    const text = buildTicketText({ ...base, items: [] });
    expect(text).toContain('Detalle de items no registrado');
  });

  it('incluye el detalle del medio de pago', () => {
    const text = buildTicketText({
      ...base,
      paymentMethod: 'transfer',
      paymentDetails: ['Banco origen: Galicia', 'Comprobante: 12345'],
    });
    expect(text).toContain('Banco origen: Galicia');
    expect(text).toContain('Comprobante: 12345');
  });
});
