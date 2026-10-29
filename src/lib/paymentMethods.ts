/**
 * Medios de pago — fuente única de verdad.
 *
 * Antes cada vista tenía su propia lista (y Mercado Pago no estaba en
 * ninguna), por lo que las ventas cobradas con MP se imputaban a efectivo.
 */

export type PaymentMethod = 'cash' | 'transfer' | 'card' | 'mercadopago';

export interface PaymentMethodMeta {
  value: PaymentMethod;
  label: string;
  color: string;
}

export const PAYMENT_METHODS: PaymentMethodMeta[] = [
  { value: 'cash', label: 'Efectivo', color: '#10b981' },
  { value: 'card', label: 'Tarjeta', color: '#3B82F6' },
  { value: 'transfer', label: 'Transferencia', color: '#f59e0b' },
  { value: 'mercadopago', label: 'Mercado Pago', color: '#a855f7' },
];

const BY_VALUE = new Map(PAYMENT_METHODS.map((m) => [m.value, m]));

/** Etiqueta legible de un medio de pago (desconocidos → "Efectivo"). */
export const paymentLabel = (method?: string | null): string =>
  BY_VALUE.get((method || 'cash') as PaymentMethod)?.label ?? 'Efectivo';

/** Color asociado a un medio de pago. */
export const paymentColor = (method?: string | null): string =>
  BY_VALUE.get((method || 'cash') as PaymentMethod)?.color ?? '#10b981';

/** Normaliza el medio de pago de una venta (null/vacío → efectivo). */
export const normalizePaymentMethod = (method?: string | null): PaymentMethod =>
  (BY_VALUE.get((method || 'cash') as PaymentMethod)?.value ?? 'cash') as PaymentMethod;
