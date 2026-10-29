/**
 * Compartir archivos.
 *
 * `wa.me` sólo permite precargar TEXTO: no se puede adjuntar un PDF por
 * deep link. Para mandar el ticket como documento hay que usar la Web Share
 * API (`navigator.share({ files })`), que en el móvil abre la hoja de
 * compartir del sistema — ahí WhatsApp aparece como destino y el PDF viaja
 * como archivo.
 *
 * En escritorio, donde la Web Share API no existe, el archivo se descarga y
 * el usuario lo adjunta a mano en WhatsApp.
 */

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'unsupported';

/** ¿El navegador puede compartir archivos (y no sólo texto)? */
export function canShareFiles(): boolean {
  try {
    if (typeof navigator === 'undefined' || !navigator.canShare) return false;
    const probe = new File([new Blob(['x'])], 'probe.txt', { type: 'text/plain' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Descarga un blob al disco. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * Comparte un archivo. Si el dispositivo no lo soporta, lo descarga.
 * Ojo: `navigator.share` exige que se llame dentro del gesto del usuario,
 * por eso esta función no debe esperar nada antes de invocarlo.
 */
export async function shareFile(
  file: File,
  opts: { title?: string; text?: string } = {}
): Promise<ShareOutcome> {
  if (canShareFiles()) {
    try {
      const payload: ShareData = { files: [file] };
      if (opts.title) payload.title = opts.title;
      if (opts.text) payload.text = opts.text;
      await navigator.share(payload);
      return 'shared';
    } catch (err: any) {
      // El usuario canceló la hoja de compartir: no hay que hacer fallback.
      if (err?.name === 'AbortError') return 'cancelled';
      // Cualquier otro error (p.ej. abort por permiso) cae al fallback.
    }
  }

  try {
    downloadBlob(file, file.name);
    return 'downloaded';
  } catch {
    return 'unsupported';
  }
}
