import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizePhone,
  isValidPhone,
  buildWhatsAppUrl,
  buildCopyText,
  openExternalUrl,
  openWhatsAppChat,
  sendTicketWhatsApp,
} from '../whatsapp';

describe('normalizePhone', () => {
  it('deja solo los dígitos', () => {
    expect(normalizePhone('+54 9 11 2345-6789')).toBe('5491123456789');
    expect(normalizePhone('(011) 2345-6789')).toBe('01123456789');
    expect(normalizePhone(null)).toBe('');
  });
});

describe('isValidPhone', () => {
  it('acepta 10 a 15 dígitos', () => {
    expect(isValidPhone('5491123456789')).toBe(true);
    expect(isValidPhone('1123456789')).toBe(true);
  });
  it('rechaza números incompletos o de más', () => {
    expect(isValidPhone('549112345')).toBe(false);
    expect(isValidPhone('54911234567890123')).toBe(false);
    expect(isValidPhone('')).toBe(false);
    expect(isValidPhone(undefined)).toBe(false);
  });
});

describe('buildWhatsAppUrl', () => {
  it('arma el deep link con el texto codificado', () => {
    const url = buildWhatsAppUrl('+54 9 11 2345-6789', 'Hola & chau');
    expect(url).toBe('https://wa.me/5491123456789?text=Hola%20%26%20chau');
  });
});

describe('buildCopyText', () => {
  it('identifica a quién se envió el comprobante', () => {
    const out = buildCopyText('TICKET TOTAL $100', '5491123456789');
    expect(out).toContain('COPIA');
    expect(out).toContain('5491123456789');
    expect(out).toContain('TICKET TOTAL $100');
  });
});

describe('openExternalUrl', () => {
  let clicks: HTMLAnchorElement[];
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clicks = [];
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('abre con un anchor target=_blank (necesario para delegar a la app en PWA)', () => {
    expect(openExternalUrl('https://wa.me/5491123456789?text=hola')).toBe(true);
    expect(clicks).toHaveLength(1);
    expect(clicks[0].target).toBe('_blank');
    expect(clicks[0].rel).toContain('noopener');
    expect(clicks[0].href).toContain('https://wa.me/5491123456789');
  });

  it('no hace nada con una URL vacía', () => {
    expect(openExternalUrl('')).toBe(false);
    expect(clicks).toHaveLength(0);
  });
});

describe('openWhatsAppChat', () => {
  let clicks: HTMLAnchorElement[];
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clicks = [];
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('abre el chat con el número normalizado', () => {
    expect(openWhatsAppChat('+54 9 11 2345-6789', 'texto')).toBe(true);
    expect(clicks).toHaveLength(1);
    expect(clicks[0].href).toBe('https://wa.me/5491123456789?text=texto');
  });

  it('no abre nada si el número es inválido', () => {
    expect(openWhatsAppChat('123', 'texto')).toBe(false);
    expect(clicks).toHaveLength(0);
  });
});

describe('sendTicketWhatsApp', () => {
  let clicks: HTMLAnchorElement[];
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clicks = [];
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('abre solo el chat del cliente si no hay número de copia', () => {
    const res = sendTicketWhatsApp({ toPhone: '5491123456789', text: 'ticket' });
    expect(res.customerOpened).toBe(true);
    expect(res.copyOpened).toBe(false);
    expect(res.copyPhone).toBe('');
    expect(clicks).toHaveLength(1);
  });

  it('abre el chat del cliente y el de la copia', () => {
    const res = sendTicketWhatsApp({
      toPhone: '5491123456789',
      text: 'ticket',
      copyPhone: '5491199988877',
    });
    expect(res.customerOpened).toBe(true);
    expect(res.copyOpened).toBe(true);
    expect(res.copyPhone).toBe('5491199988877');
    expect(clicks).toHaveLength(2);
  });

  it('abre primero la copia para que el chat del cliente quede al frente', () => {
    sendTicketWhatsApp({
      toPhone: '5491123456789',
      text: 'ticket',
      copyPhone: '5491199988877',
    });
    expect(clicks[0].href).toContain('wa.me/5491199988877');
    expect(clicks[1].href).toContain('wa.me/5491123456789');
  });

  it('la copia lleva el encabezado que identifica al cliente', () => {
    sendTicketWhatsApp({
      toPhone: '5491123456789',
      text: 'ticket',
      copyPhone: '5491199988877',
    });
    expect(decodeURIComponent(clicks[0].href)).toContain('COPIA');
    expect(decodeURIComponent(clicks[0].href)).toContain('5491123456789');
  });

  it('no duplica el chat si la copia es el mismo número que el cliente', () => {
    const res = sendTicketWhatsApp({
      toPhone: '5491123456789',
      text: 'ticket',
      copyPhone: '5491123456789',
    });
    expect(res.copyOpened).toBe(false);
    expect(clicks).toHaveLength(1);
  });

  it('ignora un número de copia inválido', () => {
    const res = sendTicketWhatsApp({
      toPhone: '5491123456789',
      text: 'ticket',
      copyPhone: '123',
    });
    expect(res.copyOpened).toBe(false);
    expect(res.customerOpened).toBe(true);
    expect(clicks).toHaveLength(1);
  });
});
