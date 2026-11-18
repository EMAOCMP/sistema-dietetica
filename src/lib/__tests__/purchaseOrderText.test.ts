import { describe, it, expect } from 'vitest';
import {
  buildPurchaseOrderText,
  purchaseOrderNumberLabel,
  type PurchaseOrderTextData,
} from '../purchaseOrderText';

// Fecha construida en hora local para que el formato no dependa de la zona.
const createdAt = new Date(2026, 10, 11, 12, 0, 0).toISOString();

const base: PurchaseOrderTextData = {
  id: 'abcdef1234567890',
  orderNumber: 'OC-000012',
  supplierName: 'Distribuidora Natural',
  createdAt,
  notes: null,
  items: [
    { name: 'Yogur griego', quantity: 12, unit: 'un', unitCost: 1200 },
    { name: 'Almendras', quantity: 2.5, unit: 'kg', unitCost: 8500 },
  ],
};

describe('purchaseOrderNumberLabel', () => {
  it('usa el número de orden cuando existe', () => {
    expect(purchaseOrderNumberLabel(base)).toBe('OC-000012');
  });
  it('cae al prefijo del id si no hay número', () => {
    expect(purchaseOrderNumberLabel({ ...base, orderNumber: null })).toBe('ABCDEF12');
  });
});

describe('buildPurchaseOrderText', () => {
  it('incluye saludo, número de orden y fecha', () => {
    const text = buildPurchaseOrderText(base);
    expect(text.split('\n')[0]).toBe('Hola Distribuidora Natural, te paso la orden de compra:');
    expect(text).toContain('*Orden OC-000012*');
    expect(text).toContain('Fecha: 11/11/2026');
  });

  it('usa kg y un según el producto', () => {
    const text = buildPurchaseOrderText(base);
    expect(text).toContain('- Yogur griego: 12 un');
    expect(text).toContain('- Almendras: 2,5 kg');
  });

  it('calcula el costo estimado con el costo congelado', () => {
    const text = buildPurchaseOrderText(base);
    // 12 × 1.200 = 14.400 | 2,5 × 8.500 = 21.250 | total 35.650
    expect(text).toContain('× $1.200,00 = $14.400,00');
    expect(text).toContain('× $8.500,00 = $21.250,00');
    expect(text).toContain('*Costo estimado: $35.650,00*');
  });

  it('prioriza el costo congelado sobre el costo actual', () => {
    const text = buildPurchaseOrderText({
      ...base,
      items: [{ name: 'Yogur griego', quantity: 1, unit: 'un', unitCost: 1000, fallbackCost: 9999 }],
    });
    expect(text).toContain('$1.000,00');
    expect(text).not.toContain('9.999');
  });

  it('usa el costo actual si la orden no tiene costo guardado', () => {
    const text = buildPurchaseOrderText({
      ...base,
      items: [{ name: 'Yogur griego', quantity: 2, unit: 'un', unitCost: null, fallbackCost: 1500 }],
    });
    expect(text).toContain('× $1.500,00 = $3.000,00');
  });

  it('avisa cuántos productos no tienen costo cargado', () => {
    const text = buildPurchaseOrderText({
      ...base,
      items: [
        { name: 'Yogur griego', quantity: 2, unit: 'un', unitCost: 1000 },
        { name: 'Granola', quantity: 1, unit: 'un', unitCost: null, fallbackCost: 0 },
      ],
    });
    expect(text).toContain('- Granola: 1 un');
    expect(text).toContain('(1 producto sin costo cargado)');
  });

  it('no muestra total si ningún producto tiene costo', () => {
    const text = buildPurchaseOrderText({
      ...base,
      items: [{ name: 'Granola', quantity: 1, unit: 'un', unitCost: null, fallbackCost: 0 }],
    });
    expect(text).not.toContain('Costo estimado');
  });

  it('aclara que los precios son estimados', () => {
    const text = buildPurchaseOrderText(base);
    expect(text).toContain('Los precios son estimados y se confirman al recibir la mercadería.');
  });

  it('incluye notas y evita "Hola Sin proveedor"', () => {
    const text = buildPurchaseOrderText({ ...base, supplierName: 'Sin proveedor', notes: 'Entregar el lunes' });
    expect(text.split('\n')[0]).toBe('Hola, te paso la orden de compra:');
    expect(text).toContain('Notas: Entregar el lunes');
  });
});
