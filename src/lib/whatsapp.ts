/**
 * Helpers de WhatsApp.
 *
 * La app no usa la API de Meta: el envío es un deep link que abre el chat con
 * el mensaje ya cargado y el usuario confirma el envío a mano.
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
 *
 * NOTA (números): WhatsApp exige el formato internacional sin `+`. En Argentina
 * es `549` + área + número, SIN el prefijo `0` y (opcionalmente) sin el `15`.
 * Un número como `03834351051` no existe para WhatsApp: hay que convertirlo a
 * `5493834351051`. `normalizeArgPhone` hace esa limpieza.
 */

/** Deja solo los dígitos del número. */
export function normalizePhone(raw?: string | null): string {
  return (raw || '').replace(/\D/g, '');
}

/**
 * Normaliza un teléfono argentino al formato internacional de WhatsApp
 * (549 + área + número, sin `0`, sin `15`, sin `+`).
 *
 *   03834351051   -> 5493834351051
 *   3834351051    -> 5493834351051
 *   +54 9 11 2345-6789 -> 5491123456789
 *   5491123456789 -> 5491123456789
 */
export function normalizeArgPhone(raw?: string | null): string {
  let d = normalizePhone(raw);
  if (!d) return '';

  if (d.startsWith('00')) d = d.slice(2);          // prefijo internacional
  if (d.startsWith('54')) d = d.slice(2);          // código de país
  if (d.startsWith('0')) d = d.slice(1);           // prefijo interurbano

  // 9 + área + número (11 o 12 dígitos): ya viene en formato internacional
  if (d.startsWith('9') && (d.length === 11 || d.length === 12)) return `54${d}`;

  // área + 15 + número: el "15" no va en formato internacional.
  // El área puede tener 3, 2 o 4 dígitos: se prueba en ese orden.
  if (d.length >= 11 && !d.startsWith('9')) {
    for (const areaLen of [3, 2, 4]) {
      if (d.slice(areaLen, areaLen + 2) !== '15') continue;
      const rest = d.slice(0, areaLen) + d.slice(areaLen + 2);
      if (rest.length >= 8 && rest.length <= 11) return `549${rest}`;
    }
    return `549${d}`;
  }

  // área + número (10 dígitos)
  if (d.length === 10) return `549${d}`;

  return d;
}

/** ¿El número sirve para abrir un chat de WhatsApp? */
export function isValidPhone(raw?: string | null): boolean {
  const c = normalizeArgPhone(raw);
  return c.length >= 11 && c.length <= 15;
}

/** Agrupa dígitos de a 3, dejando el último bloque de 4. */
function groupDigits(s: string): string {
  if (s.length <= 4) return s;
  const parts: string[] = [s.slice(-4)];
  let head = s.slice(0, -4);
  while (head.length > 3) {
    parts.unshift(head.slice(-3));
    head = head.slice(0, -3);
  }
  if (head) parts.unshift(head);
  return parts.join(' ');
}

/** Formato legible para mostrar: "+54 9 383 435 1051". */
export function formatPhoneForDisplay(raw?: string | null): string {
  const d = normalizeArgPhone(raw);
  if (!d) return '';
  if (d.startsWith('549')) return `+54 9 ${groupDigits(d.slice(3))}`;
  if (d.startsWith('54')) return `+54 ${groupDigits(d.slice(2))}`;
  return `+${groupDigits(d)}`;
}

/** Link universal: en el móvil abre la app, en la PC ofrece app / WhatsApp Web. */
export function buildWhatsAppUrl(phone: string, text: string): string {
  return `https://api.whatsapp.com/send?phone=${normalizeArgPhone(phone)}&text=${encodeURIComponent(text)}`;
}

/** Link directo a WhatsApp Web (saltea la pantalla intermedia). */
export function buildWhatsAppWebUrl(phone: string, text: string): string {
  return `https://web.whatsapp.com/send?phone=${normalizeArgPhone(phone)}&text=${encodeURIComponent(text)}`;
}

/** ¿Estamos en un celular/tablet? (en PC vamos directo a WhatsApp Web) */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPod|Mobile|Windows Phone/i.test(ua)) return true;
  // iPadOS 13+ se presenta como Mac: se reconoce por los puntos táctiles.
  if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;
  return false;
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
 * Abre el chat de WhatsApp.
 * - `auto` (celular): link universal → se abre la app de WhatsApp.
 * - `auto` (PC): link directo a WhatsApp Web → evita la pantalla intermedia
 *   (que era el paso que dead-ending en una pantalla en negro sin sesión).
 * - `web`: fuerza WhatsApp Web.
 * - `universal`: fuerza la pantalla con "Abrir aplicación" / "Continuar en
 *   WhatsApp Web" (útil en PC si tenés WhatsApp Desktop instalado).
 */
export function openWhatsAppChat(
  phone: string,
  text: string,
  mode: 'auto' | 'web' | 'universal' = 'auto'
): boolean {
  if (!isValidPhone(phone)) return false;
  const useWeb = mode === 'web' || (mode === 'auto' && !isMobileDevice());
  const url = useWeb ? buildWhatsAppWebUrl(phone, text) : buildWhatsAppUrl(phone, text);
  return openExternalUrl(url);
}

/** Abre la pantalla de inicio de sesión de WhatsApp Web (escaneo de QR). */
export function openWhatsAppWebLogin(): boolean {
  return openExternalUrl('https://web.whatsapp.com');
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
  return `*COPIA - enviado al ${normalizeArgPhone(toPhone)}*\n\n${text}`;
}

export interface WhatsAppSendResult {
  /** Se solicitó abrir el chat del cliente. */
  customerOpened: boolean;
  /** Se solicitó abrir el chat con la copia para el negocio. */
  copyOpened: boolean;
  /** Número (normalizado) del cliente. */
  toPhone: string;
  /** Número (normalizado) al que se intentó mandar la copia. */
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
  /** Cómo abrir el chat: 'auto' | 'web' | 'universal'. */
  mode?: 'auto' | 'web' | 'universal';
}

/**
 * Abre el chat del cliente y, si corresponde, también el chat del negocio con
 * una copia del mensaje. La copia se abre primero para que el chat del cliente
 * quede al frente y sea lo último que ve el usuario.
 */
export function sendTicketWhatsApp(opts: SendTicketOptions): WhatsAppSendResult {
  const toPhone = normalizeArgPhone(opts.toPhone);
  const copyPhone = normalizeArgPhone(opts.copyPhone);
  const hasCopy = isValidPhone(copyPhone) && copyPhone !== toPhone;
  const mode = opts.mode || 'auto';

  const copyOpened = hasCopy
    ? openWhatsAppChat(copyPhone, opts.copyText ?? buildCopyText(opts.text, toPhone), mode)
    : false;

  const customerOpened = openWhatsAppChat(toPhone, opts.text, mode);

  return { customerOpened, copyOpened, toPhone, copyPhone: hasCopy ? copyPhone : '' };
}
