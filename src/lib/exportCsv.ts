/**
 * Exporta filas a CSV compatible con Excel en español:
 * - BOM UTF-8 para tildes/ñ
 * - separador ";" (el que Excel es-AR espera)
 * - comillas escapadas
 */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [...(headers.length ? [headers.map(esc).join(';')] : []), ...rows.map((r) => r.map(esc).join(';'))];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function stampName(prefix: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`;
}

/** Monto prolijo para CSV es-AR: "1.234,56" (Excel lo lee como número). */
export function fmtMoney(n: unknown): string {
  if (n === null || n === undefined || n === '') return '';
  const v = Number(n);
  if (!isFinite(v)) return '';
  return v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface ContadorRow {
  ticket: string;
  fecha: string;
  cliente: string;
  doc?: string;
  vendedor: string;
  pago: string;
  tipo: string;
  ivaCond?: string;
  neto?: number;
  iva?: number;
  estado: string;
  total: number;
}

/**
 * Versión para contador: SIN costos/ganancia, CON resumen por medio
 * de pago arriba y columnas fiscales (CUIT, factura, CAE, neto, IVA)
 * listas para completar cuando el cliente pase los datos.
 */
export function downloadContadorCsv(prefix: string, periodo: string, rows: ContadorRow[]) {
  const valid = rows.filter((r) => r.estado !== 'Anulada');
  const anuladas = rows.filter((r) => r.estado === 'Anulada');
  const sum = (rs: ContadorRow[]) => rs.reduce((a, r) => a + Number(r.total), 0);
  const byPago = (p: string) => sum(valid.filter((r) => r.pago === p));

  const out: (string | number)[][] = [
    ['RESUMEN', ''],
    ['Período', periodo],
    ['Generado', new Date().toLocaleString('es-AR')],
    ['Ventas completadas', valid.length],
    ['Facturación total', fmtMoney(sum(valid))],
    ['Efectivo', fmtMoney(byPago('Efectivo'))],
    ['Transferencia', fmtMoney(byPago('Transferencia'))],
    ['Tarjeta', fmtMoney(byPago('Tarjeta'))],
    ['Mercado Pago', fmtMoney(byPago('Mercado Pago'))],
    ['Anuladas (cantidad)', anuladas.length],
    ['Anuladas (monto)', fmtMoney(sum(anuladas))],
    [],
    ['DETALLE', '', '', '', '', '', '', '', '', '', ''],
    ['Ticket', 'Fecha', 'Cliente', 'CUIT/DNI', 'Vendedor', 'Pago', 'Tipo doc', 'N° Factura', 'CAE', 'Cond. IVA', 'Neto', 'IVA', 'Estado', 'Total'],
    ...rows.map((r) => [
      r.ticket, r.fecha, r.cliente, r.doc || '', r.vendedor, r.pago, r.tipo, '', '', r.ivaCond || '',
      fmtMoney(r.neto), fmtMoney(r.iva), r.estado, fmtMoney(r.total),
    ]),
    [],
    ['TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', fmtMoney(sum(valid))],
  ];
  downloadCsv(stampName(prefix), [], out as (string | number)[][]);
}
