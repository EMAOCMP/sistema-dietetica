import { describe, it, expect } from 'vitest';
import {
  computeTotals,
  addToCart,
  updateQuantity,
  setQuantity,
  restoreRemoved,
  checkoutItems,
  priceOf,
  itemSubtotal,
  itemProfit,
  parseAmount,
  stockOf,
  round2,
} from '../cartService';
import type { CartItem, Product } from '../../types';

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  barcode: '7791120037559',
  name: 'Producto Test',
  category: 'General',
  unit_type: 'unit',
  cost_price: 100,
  wholesale_price: 150,
  retail_price: 200,
  stock_quantity: 10,
  min_stock: 5,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

const item = (over: Partial<CartItem> = {}): CartItem => ({
  product: product(),
  quantity: 1,
  priceType: 'retail',
  discount: 0,
  ...over,
});

const noDiscount = { discountType: 'percent' as const, discountValue: '0' };
const pickup = { dispatchType: 'pickup' as const, deliveryFeeType: 'free' as const, deliveryFeeValue: '0' };

describe('parseAmount', () => {
  it('acepta coma o punto decimal', () => {
    expect(parseAmount('12,50')).toBe(12.5);
    expect(parseAmount('12.50')).toBe(12.5);
    expect(parseAmount(' 1.234,56 ')).toBe(1234.56);
  });

  it('devuelve 0 para valores inválidos', () => {
    expect(parseAmount('')).toBe(0);
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount('abc')).toBe(0);
    expect(parseAmount(NaN)).toBe(0);
  });
});

describe('stockOf', () => {
  it('devuelve el stock numérico', () => {
    expect(stockOf(product({ stock_quantity: 7 }))).toBe(7);
  });

  it('trata un stock no numérico como ilimitado', () => {
    expect(stockOf({ stock_quantity: undefined as any })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('computeTotals', () => {
  it('calcula subtotal, descuento y total sin envío', () => {
    const t = computeTotals(
      [item({ quantity: 2 })],
      { discountType: 'percent', discountValue: '10' },
      pickup
    );
    // 2 x 200 = 400; -10% => 360
    expect(t.rawSubtotal).toBe(400);
    expect(t.discountVal).toBe(40);
    expect(t.subtotalAfterDiscount).toBe(360);
    expect(t.deliveryFee).toBe(0);
    expect(t.totalAmount).toBe(360);
  });

  it('la ganancia NO incluye el costo de envío como margen', () => {
    const cart = [item({ quantity: 1 })];
    const t = computeTotals(
      cart,
      noDiscount,
      { dispatchType: 'delivery', deliveryFeeType: 'fixed', deliveryFeeValue: '500' }
    );
    // Margen: (200 - 100) = 100. El envío se cobra, no es ganancia.
    expect(t.totalProfit).toBe(100);
    expect(t.totalAmount).toBe(700);
  });

  it('la ganancia descuenta el descuento por ítem', () => {
    const cart = [item({ quantity: 2, discount: 10 })];
    const t = computeTotals(cart, noDiscount, pickup);
    // Venta: 2 x 200 = 400, -10% de línea = 360 de ingreso.
    // Costo: 2 x 100 = 200. Ganancia: 160 (no 200).
    expect(t.rawSubtotal).toBe(360);
    expect(t.totalProfit).toBe(160);
  });

  it('la ganancia descuenta el descuento global', () => {
    const t = computeTotals(
      [item({ quantity: 1 })],
      { discountType: 'fixed', discountValue: '50' },
      pickup
    );
    expect(t.totalProfit).toBe(50); // 100 de margen - 50 de descuento
  });

  it('un descuento fijo negativo NO aumenta el total', () => {
    const t = computeTotals(
      [item({ quantity: 1 })],
      { discountType: 'fixed', discountValue: '-50' },
      pickup
    );
    expect(t.discountVal).toBe(0);
    expect(t.totalAmount).toBe(200);
  });

  it('acota el descuento porcentual al 100%', () => {
    const t = computeTotals(
      [item({ quantity: 1 })],
      { discountType: 'percent', discountValue: '250' },
      pickup
    );
    expect(t.discountVal).toBe(200);
    expect(t.totalAmount).toBe(0);
  });

  it('acepta coma decimal en el valor del descuento y del envío', () => {
    const t = computeTotals(
      [item({ quantity: 1 })],
      { discountType: 'percent', discountValue: '12,5' },
      { dispatchType: 'delivery', deliveryFeeType: 'fixed', deliveryFeeValue: '10,50' }
    );
    expect(t.discountVal).toBe(25);
    expect(t.deliveryFee).toBe(10.5);
    expect(t.totalAmount).toBe(185.5);
  });

  it('el envío porcentual se calcula sobre el subtotal descontado', () => {
    const t = computeTotals(
      [item({ quantity: 1 })],
      noDiscount,
      { dispatchType: 'delivery', deliveryFeeType: 'percent', deliveryFeeValue: '10' }
    );
    expect(t.deliveryFee).toBe(20);
    expect(t.totalAmount).toBe(220);
  });
});

describe('addToCart', () => {
  it('agrega un producto nuevo', () => {
    const r = addToCart([], product(), 2, 'retail');
    expect(r.status).toBe('added');
    if (r.status === 'added') {
      expect(r.cart).toHaveLength(1);
      expect(r.cart[0].quantity).toBe(2);
      expect(r.clampedTo).toBeNull();
    }
  });

  it('incrementa la cantidad si ya está en el carrito', () => {
    const first = addToCart([], product(), 2, 'retail');
    if (first.status !== 'added') throw new Error('setup');
    const second = addToCart(first.cart, product(), 3, 'retail');
    if (second.status !== 'added') throw new Error('setup');
    expect(second.cart).toHaveLength(1);
    expect(second.cart[0].quantity).toBe(5);
  });

  it('recorta la cantidad al stock disponible', () => {
    const r = addToCart([], product({ stock_quantity: 5 }), 8, 'retail');
    expect(r.status).toBe('added');
    if (r.status === 'added') {
      expect(r.cart[0].quantity).toBe(5);
      expect(r.clampedTo).toBe(5);
    }
  });

  it('rechaza si ya se agotó el stock', () => {
    const first = addToCart([], product({ stock_quantity: 2 }), 2, 'retail');
    if (first.status !== 'added') throw new Error('setup');
    const second = addToCart(first.cart, product({ stock_quantity: 2 }), 1, 'retail');
    expect(second.status).toBe('insufficient');
    if (second.status === 'insufficient') {
      expect(second.reason).toBe('max_reached');
      expect(second.available).toBe(2);
    }
  });
});

describe('updateQuantity', () => {
  it('no deja superar el stock', () => {
    const cart = [item({ quantity: 9 })];
    expect(updateQuantity(cart, 'p1', 5)).toBeNull();
  });

  it('elimina el ítem cuando la cantidad llega a 0', () => {
    const cart = [item({ quantity: 1 })];
    const next = updateQuantity(cart, 'p1', -1);
    expect(next).toHaveLength(0);
  });
});

describe('setQuantity', () => {
  it('fija una cantidad dentro del stock', () => {
    const cart = [item({ quantity: 1 })];
    const next = setQuantity(cart, 'p1', 4);
    expect(next?.[0].quantity).toBe(4);
  });

  it('rechaza una cantidad por encima del stock', () => {
    const cart = [item({ quantity: 1 })];
    expect(setQuantity(cart, 'p1', 99)).toBeNull();
  });
});

describe('restoreRemoved', () => {
  it('no muta el carrito original', () => {
    const cart = [item({ quantity: 2 })];
    const snapshot = JSON.parse(JSON.stringify(cart));
    restoreRemoved(cart, [item({ quantity: 1 })]);
    expect(cart).toEqual(snapshot);
  });

  it('reintegra el ítem quitado', () => {
    const removed = [item({ quantity: 3 })];
    const next = restoreRemoved([], removed);
    expect(next).toHaveLength(1);
    expect(next[0].quantity).toBe(3);
  });

  it('no supera el stock al reincorporar', () => {
    const cart = [item({ quantity: 8 })];
    const next = restoreRemoved(cart, [item({ quantity: 5 })]);
    expect(next[0].quantity).toBe(10);
  });
});

describe('checkoutItems y helpers', () => {
  it('priceOf usa el tipo de precio del ítem', () => {
    expect(priceOf(item({ priceType: 'wholesale' }))).toBe(150);
    expect(priceOf(item({ priceType: 'retail' }))).toBe(200);
  });

  it('itemSubtotal aplica el descuento de línea', () => {
    expect(itemSubtotal(item({ quantity: 2, discount: 10 }))).toBe(360);
  });

  it('itemProfit descuenta el descuento de línea', () => {
    expect(itemProfit(item({ quantity: 2, discount: 10 }))).toBe(160);
  });

  it('checkoutItems serializa el descuento en pesos', () => {
    const rows = checkoutItems([item({ quantity: 2, discount: 10 })]);
    expect(rows[0].discount_pct).toBe(10);
    expect(rows[0].discount_amount).toBe(40);
    expect(rows[0].unit_price).toBe(200);
  });
});

describe('round2', () => {
  it('redondea a 2 decimales', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(10.567)).toBe(10.57);
  });
});
