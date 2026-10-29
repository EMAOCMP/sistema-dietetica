/**
 * Datos del negocio (ticket, encabezados). MVP: localStorage por dispositivo.
 * Clave: dv-business { name, address, phone, cuit, footer, myWhatsapp }
 *
 * myWhatsapp: WhatsApp del dueño del negocio. Cada comprobante enviado por
 * WhatsApp se copia también a este número para que quede el registro.
 */

export interface BusinessSettings {
  name: string;
  address: string;
  phone: string;
  cuit: string;
  footer: string;
  myWhatsapp: string;
}

const KEY = 'dv-business';
const COPY_KEY = 'dv-copy-to-me';

export const DEFAULT_BUSINESS: BusinessSettings = {
  name: 'DIETETICA VISHAL',
  address: '',
  phone: '',
  cuit: '',
  footer: 'Dietética Vishal • Lo natural se siente todos los días 🌿',
  myWhatsapp: '',
};

export function loadBusiness(): BusinessSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_BUSINESS };
    return { ...DEFAULT_BUSINESS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_BUSINESS };
  }
}

export function saveBusiness(b: BusinessSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch { /* noop */ }
}

/** Preferencia: mandar una copia de cada comprobante al WhatsApp del negocio. */
export function loadCopyToMe(): boolean {
  try {
    return localStorage.getItem(COPY_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveCopyToMe(value: boolean): void {
  try {
    localStorage.setItem(COPY_KEY, value ? '1' : '0');
  } catch { /* noop */ }
}
