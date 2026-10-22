/**
 * Posicionamiento del coach mark (tarjeta del tour).
 *
 * Regla: la tarjeta se coloca al costado del elemento resaltado y nunca lo
 * tapa. Si el lado pedido no entra en pantalla se prueban los alternativos y,
 * si el elemento es demasiado grande para esquivarlo, se elige la posición que
 * menos lo superpone.
 */

export interface TipRect { top: number; left: number; width: number; height: number }

export type TipPlacement = 'top' | 'bottom' | 'left' | 'right';

const GAP = 16;
const MARGIN = 12;
/** Bajo el header fijo de la app (h-16) para no taparlo. */
const TOP_SAFE = 76;
const BOTTOM_SAFE = 16;

export function computeTipBox(
  target: TipRect,
  placement: TipPlacement,
  tipW: number,
  tipH: number,
  viewportW: number,
  viewportH: number,
): { left: number; top: number } {
  const order: TipPlacement[] =
    placement === 'top' ? ['top', 'bottom', 'right', 'left']
    : placement === 'bottom' ? ['bottom', 'top', 'right', 'left']
    : placement === 'left' ? ['left', 'right', 'bottom', 'top']
    : ['right', 'left', 'bottom', 'top'];

  const maxLeft = Math.max(MARGIN, viewportW - tipW - MARGIN);
  const maxTop = Math.max(TOP_SAFE, viewportH - tipH - BOTTOM_SAFE);
  const targetRight = target.left + target.width;
  const targetBottom = target.top + target.height;

  const candidates = order.map((side) => {
    let left: number;
    let top: number;
    if (side === 'bottom' || side === 'top') {
      left = target.left + target.width / 2 - tipW / 2;
      top = side === 'bottom' ? targetBottom + GAP : target.top - tipH - GAP;
    } else {
      left = side === 'right' ? targetRight + GAP : target.left - tipW - GAP;
      top = target.top + target.height / 2 - tipH / 2;
    }

    const fits =
      side === 'bottom' ? targetBottom + GAP + tipH <= viewportH - BOTTOM_SAFE
      : side === 'top' ? target.top - GAP - tipH >= TOP_SAFE
      : side === 'right' ? targetRight + GAP + tipW <= viewportW - MARGIN
      : target.left - GAP - tipW >= MARGIN;

    const clampedLeft = Math.max(MARGIN, Math.min(left, maxLeft));
    const clampedTop = Math.max(TOP_SAFE, Math.min(top, maxTop));

    const overlapW = Math.max(0, Math.min(clampedLeft + tipW, targetRight) - Math.max(clampedLeft, target.left));
    const overlapH = Math.max(0, Math.min(clampedTop + tipH, targetBottom) - Math.max(clampedTop, target.top));

    return { left: clampedLeft, top: clampedTop, fits, overlapArea: overlapW * overlapH };
  });

  // 1) entra en pantalla y no tapa el objetivo  2) no lo tapa  3) tapa lo menos
  const best =
    candidates.find((c) => c.fits && c.overlapArea === 0)
    ?? candidates.find((c) => c.overlapArea === 0)
    ?? candidates.reduce((acc, c) => (c.overlapArea < acc.overlapArea ? c : acc));

  return { left: best.left, top: best.top };
}
