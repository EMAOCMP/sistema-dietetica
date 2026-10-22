import { describe, expect, it } from 'vitest';
import { computeTipBox, type TipPlacement } from '../tipPosition';

const TIP_W = 340;
const TIP_H = 200;
const VIEW_W = 1344;
const VIEW_H = 689;

function rect(top: number, left: number, width: number, height: number) {
  return { top, left, width, height };
}

function overlaps(a: { left: number; top: number }, b: { top: number; left: number; width: number; height: number }) {
  return !(
    a.left + TIP_W <= b.left
    || a.left >= b.left + b.width
    || a.top + TIP_H <= b.top
    || a.top >= b.top + b.height
  );
}

describe('computeTipBox', () => {
  it('coloca la tarjeta debajo del objetivo cuando hay espacio', () => {
    const target = rect(280, 300, 700, 60);
    const box = computeTipBox(target, 'bottom', TIP_W, TIP_H, VIEW_W, VIEW_H);

    expect(box.top).toBeGreaterThanOrEqual(target.top + target.height);
    expect(overlaps(box, target)).toBe(false);
  });

  it('coloca la tarjeta a la derecha del objetivo si es lo pedido y hay espacio', () => {
    const target = rect(64, 0, 245, 600);
    const box = computeTipBox(target, 'right', TIP_W, TIP_H, VIEW_W, VIEW_H);

    expect(box.left).toBeGreaterThanOrEqual(target.left + target.width);
    expect(overlaps(box, target)).toBe(false);
  });

  it('evita tapar el objetivo cuando el lado pedido no entra', () => {
    // Objetivo pegado al borde derecho: "bottom" no entra y "left" tampoco.
    const target = rect(400, 1200, 130, 40);
    const box = computeTipBox(target, 'bottom', TIP_W, TIP_H, VIEW_W, VIEW_H);

    expect(overlaps(box, target)).toBe(false);
  });

  it('nunca sale de la pantalla', () => {
    const cases: Array<[ReturnType<typeof rect>, TipPlacement]> = [
      [rect(0, 0, 100, 30), 'top'],
      [rect(600, 1200, 120, 60), 'right'],
      [rect(300, 0, 80, 200), 'left'],
      [rect(60, 60, 400, 500), 'bottom'],
    ];

    for (const [target, placement] of cases) {
      const box = computeTipBox(target, placement, TIP_W, TIP_H, VIEW_W, VIEW_H);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(76); // bajo el header de la app
      expect(box.left + TIP_W).toBeLessThanOrEqual(VIEW_W);
      expect(box.top + TIP_H).toBeLessThanOrEqual(VIEW_H);
    }
  });

  it('mantiene el orden pedido si el objetivo es enorme y no hay escapatoria', () => {
    const target = rect(140, 270, 800, 500);
    const box = computeTipBox(target, 'top', TIP_W, TIP_H, VIEW_W, VIEW_H);

    // No hay lugar: la tarjeta se queda cerca del lado pedido, dentro de pantalla.
    expect(box.top).toBeGreaterThanOrEqual(76);
    expect(box.top).toBeLessThanOrEqual(VIEW_H - TIP_H);
  });
});
