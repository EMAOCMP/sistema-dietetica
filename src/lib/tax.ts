export const ALICUOTA_IVA = 0.21;

/** Alícuota configurable desde Configuración (default 21%). */
export function getIvaRate(): number {
  try {
    const v = parseFloat(localStorage.getItem('dv-iva-rate') || '');
    if (Number.isFinite(v) && v >= 0 && v < 1) return v;
  } catch { /* noop */ }
  return ALICUOTA_IVA;
}

export type IvaCond = 'CF' | 'RI' | 'MONOTRIBUTO' | 'EXENTO';

export const IVA_COND_LABELS: { value: IvaCond; label: string }[] = [
  { value: 'CF', label: 'Consumidor Final' },
  { value: 'RI', label: 'Responsable Inscripto' },
  { value: 'MONOTRIBUTO', label: 'Monotributista' },
  { value: 'EXENTO', label: 'Exento' },
];

/** Neto gravado desde un total con IVA incluido. */
export const netoFromTotal = (total: number) => total / (1 + getIvaRate());

/** IVA contenido en un total con IVA incluido. */
export const ivaFromTotal = (total: number) => total - netoFromTotal(total);

export const round2 = (n: number) => Math.round(n * 100) / 100;
