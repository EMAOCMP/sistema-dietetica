import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizePhone,
  normalizeArgPhone,
  isValidPhone,
  formatPhoneForDisplay,
  buildWhatsAppUrl,
  buildWhatsAppWebUrl,
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

describe('normalizeArgPhone', () => {
  it('quita el 0 y agrega el 549 a un número local', () => {
    expect(normalizeArgPhone('03834351051')).toBe('5493834351051');
    expect(normalizeArgPhone('3834351051')).toBe('5493834351051');
    expect(normalizeArgPhone('01123456789')).toBe('5491123456789');
  });

  it('deja intacto un número ya en formato internacional', () => {
    expect(normalizeArgPhone('5491123456789')).toBe('5491123456789');
    expect(normalizeArgPhone('+54 9 11 2345-6789')).toBe('5491123456789');
    expect(normalizeArgPhone('54991123456789')).toBe('54991123456789');
  });

  it('quita el prefijo internacional 00', () => {
    expect(normalizeArgPhone('005491123456789')).toBe('5491123456789');
  });

  it('saca el 15 intercalado en los móviles con prefijo', () => {
    // 011 15 2345-6789 -> 549 11 23456789
    expect(normalizeArgPhone('0111523456789')).toBe('5491123456789');
    // 0341 15 234567 -> 549 341 234567
    expect(normalizeArgPhone('034115234567')).toBe('549341234567');
  });

  it('devuelve vacío si no hay dígitos', () => {
    expect(normalizeArgPhone('')).toBe('');
    expect(normalizeArgPhone(null)).toBe('');
  });
});

describe('isValidPhone', () => {
  it('acepta números que se pueden normalizar', () => {
    expect(isValidPhone('03834351051')).toBe(true);
    expect(isValidPhone('5491123456789')).toBe(true);
    expect(isValidPhone('1123456789')).toBe(true);
  });
  it('rechaza números incompletos o de más', () => {
    expect(isValidPhone('549112')).toBe(false);
    expect(isValidPhone('')).toBe(false);
    expect(isValidPhone(undefined)).toBe(false);
  });
});

describe('formatPhoneForDisplay', () => {
  it('muestra el número en formato legible', () => {
    expect(formatPhoneForDisplay('03834351051')).toBe('+54 9 383 435 1051');
    expect(formatPhoneForDisplay('5491123456789')).toBe('+54 9 112 345 6789');
  });
});

describe('buildWhatsAppUrl', () => {
  it('arma el link universal con el teléfono normalizado', () => {
    const url = buildWhatsAppUrl('03834351051', 'Hola & chau');
    expect(url).toBe('https://api.whatsapp.com/send?phone=5493834351051&text=Hola%20%26%20chau');
  });
});

describe('buildWhatsAppWebUrl', () => {
  it('arma el link directo a WhatsApp Web', () => {
    const url = buildWhatsAppWebUrl('03834351051', 'texto');
    expect(url).toBe('https://web.whatsapp.com/send?phone=5493834351051&text=texto');
  });
});

describe('buildCopyText', () => {
  it('identifica a quién se envió el comprobante', () => {
    const out = buildCopyText('TICKET TOTAL $100', '03834351051');
    expect(out).toContain('COPIA');
    expect(out).toContain('5493834351051');
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
    expect(openWhatsAppChat('03834351051', 'texto', 'universal')).toBe(true);
    expect(clicks).toHaveLength(1);
    expect(clicks[0].href).toContain('phone=5493834351051');
  });

  it('el modo web va directo a web.whatsapp.com', () => {
    openWhatsAppChat('03834351051', 'texto', 'web');
    expect(clicks[0].href).toContain('https://web.whatsapp.com/send');
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
    const res = sendTicketWhatsApp({ toPhone: '03834351051', text: 'ticket' });
    expect(res.customerOpened).toBe(true);
    expect(res.copyOpened).toBe(false);
    expect(res.copyPhone).toBe('');
    expect(res.toPhone).toBe('5493834351051');
    expect(clicks).toHaveLength(1);
  });

  it('abre el chat del cliente y el de la copia', () => {
    const res = sendTicketWhatsApp({
      toPhone: '03834351051',
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
      toPhone: '03834351051',
      text: 'ticket',
      copyPhone: '5491199988877',
    });
    expect(clicks[0].href).toContain('phone=5491199988877');
    expect(clicks[1].href).toContain('phone=5493834351051');
  });

  it('la copia lleva el encabezado que identifica al cliente', () => {
    sendTicketWhatsApp({
      toPhone: '03834351051',
      text: 'ticket',
      copyPhone: '5491199988877',
    });
    expect(decodeURIComponent(clicks[0].href)).toContain('COPIA');
    expect(decodeURIComponent(clicks[0].href)).toContain('5493834351051');
  });

  it('no duplica el chat si la copia es el mismo número que el cliente', () => {
    const res = sendTicketWhatsApp({
      toPhone: '03834351051',
      text: 'ticket',
      copyPhone: '03834351051',
    });
    expect(res.copyOpened).toBe(false);
    expect(clicks).toHaveLength(1);
  });

  it('ignora un número de copia inválido', () => {
    const res = sendTicketWhatsApp({
      toPhone: '03834351051',
      text: 'ticket',
      copyPhone: '123',
    });
    expect(res.copyOpened).toBe(false);
    expect(res.customerOpened).toBe(true);
    expect(clicks).toHaveLength(1);
  });
});
