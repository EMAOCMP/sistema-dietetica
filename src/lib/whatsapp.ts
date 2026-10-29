/**
 * Helpers de WhatsApp.
 *
 * La app no usa la API de Meta: el envío es un deep link `wa.me` que abre el
 * chat con el mensaje ya cargado y el usuario confirma el envío a mano.
 *
 * Además de mandar al cliente, se puede abrir una segunda conversación con el
 * WhatsApp del negocio para que el dueño reciba una copia de todo lo que sale.
 *
 * NOTA (PWA): la app se instala como PWA `display: standalone`. En Android, un
 * `window.open()` desde una WebAPK abre el destino DENTRO de la WebView de la
 * PWA, donde el redirect `whatsapp://` no puede lanzar la app de WhatsApp.
 * Un `<a target="_blank">` sí se abre en el navegador del sistema, que sí
 * resuelve el intent. Por eso el envío se hace con un anchor y no con
 * `window.open`.
 */

/** Deja solo los dígitos del número. */
export function normalizePhone(raw?: string | null): string {
  return (raw || '').replace(/\D/g, '');
}

/** Formato válido de WhatsApp: 10 a 15 dígitos (Argentina: 549 + área + número). */
export function isValidPhone(raw?: string | null): boolean {
  const c = normalizePhone(raw);
  return c.length >= 10 && c.length <= 15;
}

export function buildWhatsAppUrl(phone: string, text: string): string {
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`;
}

/**
 * Abre una URL externa en una pestaña del navegador del sistema.
 * Usa un anchor con `target="_blank"` porque es lo único que, dentro de una
 * PWA instalada, consigue delegar a la app destino (WhatsApp).
 */
export function openExternalUrl(url: string): boolean {
  if (!url) return false;
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-hidden', 'true');
    a.style.position = 'fixed';
    a.style.left = '-9999px';
    a.style.opacity = '0';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Abre el chat de WhatsApp. Devuelve `false` si el número no es válido o si
 * el navegador no permitió abrir la pestaña.
 */
export function openWhatsAppChat(phone: string, text: string): boolean {
  const clean = normalizePhone(phone);
  if (!isValidPhone(clean)) return false;
  return openExternalUrl(buildWhatsAppUrl(clean, text));
}

/**
 * Detecta si el navegador bloqueó la apertura (popups deshabilitados).
 * Cuando la pestaña nueva toma el foco, la ventana actual pierde el foco.
 */
export function detectBlockedOpen(timeoutMs = 1200): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    let handedOff = false;
    const onBlur = () => { handedOff = true; };
    window.addEventListener('blur', onBlur);
    window.setTimeout(() => {
      window.removeEventListener('blur', onBlur);
      resolve(!handedOff);
    }, timeoutMs);
  });
}

/** Texto de la copia que recibe el negocio: identifica a quién se le envió. */
export function buildCopyText(text: string, toPhone: string): string {
  return `*COPIA - enviado al ${normalizePhone(toPhone)}*\n\n${text}`;
}

export interface WhatsAppSendResult {
  /** Se solicitó abrir el chat del cliente. */
  customerOpened: boolean;
  /** Se solicitó abrir el chat con la copia para el negocio. */
  copyOpened: boolean;
  /** Número al que se intentó mandar la copia (vacío si no aplica). */
  copyPhone: string;
}

export interface SendTicketOptions {
  /** Teléfono del cliente (obligatorio). */
  toPhone: string;
  /** Texto del ticket. */
  text: string;
  /** Teléfono del negocio: recibe una copia del mismo mensaje. */
  copyPhone?: string | null;
  /** Texto alternativo para la copia (por defecto, el mismo con un encabezado). */
  copyText?: string;
}

/**
 * Abre el chat del cliente y, si corresponde, también el chat del negocio con
 * una copia del mensaje. La copia se abre primero para que el chat del cliente
 * quede al frente y sea lo último que ve el usuario.
 */
export function sendTicketWhatsApp(opts: SendTicketOptions): WhatsAppSendResult {
  const toPhone = normalizePhone(opts.toPhone);
  const copyPhone = normalizePhone(opts.copyPhone);
  const hasCopy = isValidPhone(copyPhone) && copyPhone !== toPhone;

  const copyOpened = hasCopy
    ? openWhatsAppChat(copyPhone, opts.copyText ?? buildCopyText(opts.text, toPhone))
    : false;

  const customerOpened = openWhatsAppChat(toPhone, opts.text);

  return { customerOpened, copyOpened, copyPhone: hasCopy ? copyPhone : '' };
}
