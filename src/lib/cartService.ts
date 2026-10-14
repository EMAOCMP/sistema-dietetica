import type { CartItem, Product } from '../types';

/**
 * Lógica pura del carrito (V3 Fase 4/5): sin React ni Supabase.
 * POSView delega aquí para mantener la vista como UI.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const roundQty = (n: number) => Math.round(n * 100) / 100;

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
  const discountVal = discount.discountType === 'percent'
    ? (rawSubtotal * (parseFloat(discount.discountValue) || 0)) / 100
    : Math.min(rawSubtotal, parseFloat(discount.discountValue) || 0);
  const subtotalAfterDiscount = Math.max(0, rawSubtotal - discountVal);

  const deliveryFee = delivery.dispatchType === 'delivery'
    ? delivery.deliveryFeeType === 'free'
      ? 0
      : delivery.deliveryFeeType === 'fixed'
        ? parseFloat(delivery.deliveryFeeValue) || 0
        : (subtotalAfterDiscount * (parseFloat(delivery.deliveryFeeValue) || 0)) / 100
    : 0;

  const totalAmount = Math.max(0, subtotalAfterDiscount + deliveryFee);

  const totalProfit = cart.reduce((acc, item) => {
    const profitPerUnit = priceOf(item) - item.product.cost_price;
    return acc + profitPerUnit * item.quantity;
  }, 0) - discountVal + deliveryFee;

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
  const available = Number(product.stock_quantity);

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
  if (delta > 0 && item.quantity + delta > Number(item.product.stock_quantity)) return null;
  return cart
    .map((i) => {
      if (i.product.id !== productId) return i;
      const newQty = i.quantity + delta;
      return newQty > 0 ? { ...i, quantity: roundQty(newQty) } : null;
    })
    .filter((i): i is CartItem => i !== null);
}

/** Cambia el precio mayorista/minorista de TODO el carrito. */
export const setCartPriceType = (cart: CartItem[], t: CartItem['priceType']): CartItem[] =>
  cart.map((item) => ({ ...item, priceType: t }));

/** Restaura ítems quitados (deshacer). */
export function restoreRemoved(cart: CartItem[], removed: CartItem[]): CartItem[] {
  const next = [...cart];
  removed.forEach((ri) => {
    const ex = next.find((i) => i.product.id === ri.product.id);
    if (ex) ex.quantity = roundQty(ex.quantity + ri.quantity);
    else next.push(ri);
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
