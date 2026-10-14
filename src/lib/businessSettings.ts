/**
 * Datos del negocio (ticket, encabezados). MVP: localStorage por dispositivo.
 * Clave: dv-business { name, address, phone, cuit, footer }
 */

export interface BusinessSettings {
  name: string;
  address: string;
  phone: string;
  cuit: string;
  footer: string;
}

const KEY = 'dv-business';

export const DEFAULT_BUSINESS: BusinessSettings = {
  name: 'DIETETICA VISHAL',
  address: '',
  phone: '',
  cuit: '',
  footer: 'Dietética Vishal • Lo natural se siente todos los días 🌿',
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
