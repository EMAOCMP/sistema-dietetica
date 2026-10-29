import type { CartItem, Product } from '../types';

/**
 * Lógica pura del carrito (V3 Fase 4/5): sin React ni Supabase.
 * POSView delega aquí para mantener la vista como UI.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const roundQty = (n: number) => Math.round(n * 100) / 100;

/**
 * Acepta coma o punto decimal: "12,50" → 12.5, "12.50" → 12.5.
 * Maneja el formato argentino con separador de miles: "1.234,56" → 1234.56.
 */
export const parseAmount = (raw: string | number | null | undefined): number => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (!raw) return 0;
  let s = String(raw).trim().replace(/\s/g, '');
  if (!s) return 0;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // El separador que aparece último es el decimal; el otro es de miles.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    s = s.replace(',', '.');
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    // Patrón estricto de miles es-AR: "1.234" → 1234 (no 1.234).
    s = s.replace(/\./g, '');
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

/** Stock disponible del producto. Si no hay dato numérico, se trata como ilimitado. */
export const stockOf = (product: Pick<Product, 'stock_quantity'>): number => {
  const n = Number(product.stock_quantity);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};

export interface DiscountInput {
  discountType: 'percent' | 'fixed';
  discountValue: string;
}

export interface DeliveryInput {
  dispatchType: 'pickup' | 'delivery';
  deliveryFeeType: 'free' | 'fixed' | 'percent';
  deliveryFeeValue: string;
}

export const priceOf = (item: CartItem) =>
  item.priceType === 'wholesale' ? item.product.wholesale_price : item.product.retail_price;

export const itemSubtotal = (item: CartItem) =>
  priceOf(item) * item.quantity * (1 - (item.discount || 0) / 100);

/** Descuento aplicado a la línea, en pesos. */
export const itemDiscountAmount = (item: CartItem) =>
  priceOf(item) * item.quantity * ((item.discount || 0) / 100);

/** Margen bruto de la línea (precio - costo), ya descontado el descuento de la línea. */
export const itemProfit = (item: CartItem) =>
  (priceOf(item) - item.product.cost_price) * item.quantity - itemDiscountAmount(item);

export interface Totals {
  rawSubtotal: number;
  discountVal: number;
  subtotalAfterDiscount: number;
  deliveryFee: number;
  totalAmount: number;
  totalProfit: number;
}

export function computeTotals(cart: CartItem[], discount: DiscountInput, delivery: DeliveryInput): Totals {
  const rawSubtotal = cart.reduce((acc, item) => acc + itemSubtotal(item), 0);
  const discountPct = discount.discountType === 'percent'
    ? Math.min(100, Math.max(0, parseAmount(discount.discountValue)))
    : 0;
  const discountVal = discount.discountType === 'percent'
    ? (rawSubtotal * discountPct) / 100
    : Math.min(Math.max(0, rawSubtotal), Math.max(0, parseAmount(discount.discountValue)));
  const subtotalAfterDiscount = Math.max(0, rawSubtotal - discountVal);

  const deliveryPct = delivery.deliveryFeeType === 'percent'
    ? Math.min(100, Math.max(0, parseAmount(delivery.deliveryFeeValue)))
    : 0;
  const deliveryFee = delivery.dispatchType === 'delivery'
    ? delivery.deliveryFeeType === 'free'
      ? 0
      : delivery.deliveryFeeType === 'fixed'
        ? Math.max(0, parseAmount(delivery.deliveryFeeValue))
        : (subtotalAfterDiscount * deliveryPct) / 100
    : 0;

  const totalAmount = Math.max(0, subtotalAfterDiscount + deliveryFee);

  // Ganancia = margen de cada línea (ya con su descuento) menos el descuento global.
  // El envío NO se suma: es un cobro al cliente, no margen del negocio.
  const totalProfit = cart.reduce((acc, item) => acc + itemProfit(item), 0) - discountVal;

  return { rawSubtotal, discountVal, subtotalAfterDiscount, deliveryFee, totalAmount, totalProfit };
}

export type AddResult =
  | { status: 'added'; cart: CartItem[]; clampedTo: number | null }
  | { status: 'insufficient'; reason: 'max_reached'; available: number };

/**
 * Agrega o incrementa un producto en el carrito respetando stock disponible.
 * Si no alcanja, agrega hasta donde hay (`clampedTo` lleva la cantidad pedida).
 */
export function addToCart(
  cart: CartItem[],
  product: Product,
  quantity: number,
  priceType: CartItem['priceType']
): AddResult {
  const inCart = cart.find((i) => i.product.id === product.id)?.quantity || 0;
  const available = stockOf(product);

  let clampedTo: number | null = null;
  if (inCart + quantity > available) {
    if (inCart >= available) return { status: 'insufficient', reason: 'max_reached', available };
    quantity = roundQty(available - inCart);
    clampedTo = quantity;
  }

  const existing = cart.find((i) => i.product.id === product.id);
  if (existing) {
    return {
      status: 'added',
      clampedTo,
      cart: cart.map((i) =>
        i.product.id === product.id ? { ...i, quantity: roundQty(i.quantity + quantity) } : i
      ),
    };
  }
  return { status: 'added', clampedTo, cart: [...cart, { product, quantity, priceType, discount: 0 }] };
}

/**
 * Suma/resta delta a un ítem; lo elimina si queda en 0 o menos.
 * Devuelve null si el delta supera el stock (sin cambios).
 */
export function updateQuantity(
  cart: CartItem[],
  productId: string,
  delta: number
): CartItem[] | null {
  const item = cart.find((i) => i.product.id === productId);
  if (!item) return cart;
  if (delta > 0 && item.quantity + delta > stockOf(item.product)) return null;
  return cart
    .map((i) => {
      if (i.product.id !== productId) return i;
      const newQty = i.quantity + delta;
      return newQty > 0 ? { ...i, quantity: roundQty(newQty) } : null;
    })
    .filter((i): i is CartItem => i !== null);
}

/** Fija una cantidad exacta respetando el stock disponible. */
export function setQuantity(
  cart: CartItem[],
  productId: string,
  quantity: number
): CartItem[] | null {
  const item = cart.find((i) => i.product.id === productId);
  if (!item) return cart;
  const qty = roundQty(quantity);
  if (qty > stockOf(item.product)) return null;
  if (qty <= 0) {
    return cart.filter((i) => i.product.id !== productId);
  }
  return cart.map((i) => (i.product.id === productId ? { ...i, quantity: qty } : i));
}

/** Cambia el precio mayorista/minorista de TODO el carrito. */
export const setCartPriceType = (cart: CartItem[], t: CartItem['priceType']): CartItem[] =>
  cart.map((item) => ({ ...item, priceType: t }));

/** Restaura ítems quitados (deshacer). No muta el estado y respeta el stock. */
export function restoreRemoved(cart: CartItem[], removed: CartItem[]): CartItem[] {
  let next = [...cart];
  removed.forEach((ri) => {
    const ex = next.find((i) => i.product.id === ri.product.id);
    if (ex) {
      const target = roundQty(ex.quantity + ri.quantity);
      const max = stockOf(ex.product);
      next = next.map((i) =>
        i.product.id === ri.product.id
          ? { ...i, quantity: Number.isFinite(max) ? Math.min(target, max) : target }
          : i
      );
    } else {
      next = [...next, ri];
    }
  });
  return next;
}

/** Ítems a serializar para el checkout (payload de venta / cola offline). */
export const checkoutItems = (cart: CartItem[]) =>
  cart.map((item) => {
    const unit_price = priceOf(item);
    const pct = item.discount || 0;
    return {
      product_id: item.product.id,
      quantity: item.quantity,
      priceType: item.priceType,
      unit_price,
      cost_price: item.product.cost_price,
      discount_pct: pct,
      discount_amount: round2(unit_price * item.quantity * pct / 100),
    };
  });

export const countUnits = (cart: CartItem[]) => cart.reduce((a, i) => a + i.quantity, 0);

export { round2 };
