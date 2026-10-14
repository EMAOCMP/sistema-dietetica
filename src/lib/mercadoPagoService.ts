/**
 * Mercado Pago Integration Service
 * Orden de creación de links de pago:
 * 1) Edge Function `mp-create-preference` (token seguro en Supabase Secrets) → monto exacto
 * 2) API directa desde el navegador con access token guardado en localStorage (legacy)
 * 3) Link estático de cobro como último recurso
 *
 * Modos:
 * - "test": usa MP_ACCESS_TOKEN_TEST en la Edge Function (no cobra dinero real)
 * - "prod": usa MP_ACCESS_TOKEN (cobros REALES). Se confirma antes de guardar.
 */

import { supabase } from './supabase';

export type MpMode = 'test' | 'prod';

export interface MercadoPagoSettings {
  accessToken: string;
  publicKey: string;
  collectorId: string;
  enabled: boolean;
  /** Modo activo de la integración. Default: 'test' (seguro). */
  mpMode: MpMode;
}

export interface MpPreferenceResult {
  initPoint: string;
  sandboxInitPoint: string;
  preferenceId?: string;
  mode: 'function' | 'api' | 'link';
  isTest: boolean;
}

const MP_KEY = 'dv-mp-settings';

export const DEFAULT_MP_SETTINGS: MercadoPagoSettings = {
  accessToken: '',
  publicKey: '',
  collectorId: '',
  enabled: false,
  mpMode: 'test',
};

/** Modo activo persistido (default seguro: 'test'). */
export function getMpMode(): MpMode {
  return loadMercadoPagoSettings().mpMode === 'prod' ? 'prod' : 'test';
}

export function loadMercadoPagoSettings(): MercadoPagoSettings {
  try {
    const raw = localStorage.getItem(MP_KEY);
    if (!raw) return { ...DEFAULT_MP_SETTINGS };
    return { ...DEFAULT_MP_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_MP_SETTINGS };
  }
}

export function saveMercadoPagoSettings(settings: MercadoPagoSettings): void {
  try {
    localStorage.setItem(MP_KEY, JSON.stringify(settings));
  } catch { /* noop */ }
}

/** 1) Prueba la Edge Function en el modo indicado (devuelve null si está OK). */
export async function checkMpFunction(mode: MpMode = getMpMode()): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('mp-create-preference', {
      body: { title: 'Test', amount: 1, quantity: 1, external_reference: 'TEST', mode },
    });
    // Priorizar el error específico del body (ej. "MP_ACCESS_TOKEN_TEST no configurado")
    // sobre el mensaje genérico "non-2xx" de supabase-js.
    if (data?.error) return data.error;
    if (error) return error.message || String(error);
    if (data?.initPoint) return null;
    return 'Respuesta inesperada de la función';
  } catch (e: any) {
    return e?.message || String(e);
  }
}

/**
 * Crea la preferencia de pago para la venta.
 */
export async function createMercadoPagoPreference(data: {
  title: string;
  unitPrice: number;
  quantity: number;
  externalReference: string;
}): Promise<MpPreferenceResult> {
  const settings = loadMercadoPagoSettings();
  const mode: MpMode = settings.mpMode === 'prod' ? 'prod' : 'test';

  // 1) Edge Function (recomendado: token en Secrets, monto exacto)
  try {
    const { data: res, error } = await supabase.functions.invoke('mp-create-preference', {
      body: {
        title: data.title,
        amount: data.unitPrice,
        quantity: data.quantity,
        external_reference: data.externalReference,
        mode,
      },
    });
    if (!error && res?.initPoint) {
      return {
        initPoint: res.initPoint,
        sandboxInitPoint: res.sandboxInitPoint || res.initPoint,
        preferenceId: res.preferenceId,
        mode: 'function',
        isTest: res.isTest ?? mode === 'test',
      };
    }
  } catch { /* sigue con los fallbacks */ }

  // 2) API directa con token del navegador (legacy).
  // Solo en modo producción: en prueba se evita usar un token que podría ser real.
  if (mode !== 'test' && settings.accessToken && settings.accessToken.startsWith('APP_USR-')) {
    try {
      const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.accessToken}`,
        },
        body: JSON.stringify({
          items: [
            {
              title: data.title,
              quantity: data.quantity,
              unit_price: Number(data.unitPrice),
              currency_id: 'ARS',
            },
          ],
          external_reference: data.externalReference,
          back_urls: {
            success: window.location.origin + '/?mp=success',
            failure: window.location.origin + '/?mp=failure',
            pending: window.location.origin + '/?mp=pending',
          },
          auto_return: 'approved',
        }),
      });
      const resData = await response.json();
      if (resData.init_point) {
        return {
          initPoint: resData.init_point,
          sandboxInitPoint: resData.sandbox_init_point || resData.init_point,
          preferenceId: resData.id,
          mode: 'api',
          isTest: false,
        };
      }
    } catch (e) {
      console.warn('[MercadoPago] Error creando preferencia API:', e);
    }
  }

  // 3) Fallback: Link de pago estático con monto y referencia como query
  const fallbackUrl = `https://link.mercadopago.com.ar/dieteticavishal?monto=${data.unitPrice}&ref=${data.externalReference}`;
  return {
    initPoint: fallbackUrl,
    sandboxInitPoint: fallbackUrl,
    mode: 'link',
    isTest: mode === 'test',
  };
}
