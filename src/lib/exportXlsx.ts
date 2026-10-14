/**
 * Exportación a Excel (.xlsx) profesional:
 * - hoja detalle: bordes, filtros, encabezado congelado, anchos auto, cebra, data bars, impresión
 * - montos como números con formato $ #.##0,00 (negativos en rojo)
 * - ventas anuladas en rojo (fila completa)
 * - hoja "Resumen": KPIs, donut de medios de pago, por vendedor/tipo/despacho, Top 5 clientes
 * - hoja "Gráfico": ventas por día + ganancia por día (imágenes PNG) + tablas de datos
 * Se importa de forma dinámica para no pesar el bundle inicial.
 */

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } } as const;
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } } as const;
const CANCEL_FONT = { color: { argb: 'FFDC2626' } } as const;
const CANCEL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } } as const;
const ZEBRA_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } } as const;
const MONEY_FMT = '"$"#,##0.00;[Red]-"$"#,##0.00';
const BORDER_STYLE = 'thin' as const;
const BORDER_COLOR = { argb: 'FFCBD5E1' };
const BORDER = {
  top: { style: BORDER_STYLE, color: BORDER_COLOR },
  left: { style: BORDER_STYLE, color: BORDER_COLOR },
  bottom: { style: BORDER_STYLE, color: BORDER_COLOR },
  right: { style: BORDER_STYLE, color: BORDER_COLOR },
} as const;
const DONUT_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#8B5CF6', '#06B6D4', '#64748B', '#DC2626'];

export interface ChartBar {
  label: string;
  value: number;
  color?: string;
}

async function loadExcelJS() {
  const mod = await import('exceljs/dist/exceljs.min.js');
  return mod.default;
}

async function downloadWorkbook(wb: any, filename: string) {
  wb.creator = 'Dietética Vishal';
  wb.created = new Date();
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function styleHeader(row: any) {
  row.font = { ...HEADER_FONT };
  row.fill = { ...HEADER_FILL };
  row.eachCell((c: any) => {
    c.border = { ...BORDER };
    c.alignment = { vertical: 'middle' };
  });
  row.height = 22;
}

function styleCancelRow(row: any) {
  row.font = { ...CANCEL_FONT };
  row.fill = { ...CANCEL_FILL };
}

function borderRow(row: any) {
  row.eachCell((c: any) => { c.border = { ...BORDER }; });
}

function setMoney(cell: any, v: number | undefined | null) {
  cell.value = typeof v === 'number' && isFinite(v) ? v : 0;
  cell.numFmt = MONEY_FMT;
}

function autoWidth(ws: any) {
  ws.columns.forEach((col: any) => {
    if (!col) return;
    let max = 10;
    col.eachCell({ includeEmpty: false }, (cell: any) => {
      const v = cell.value;
      const s = v == null ? '' : typeof v === 'object' && 'text' in v ? String(v.text) : String(v);
      max = Math.max(max, Math.min(42, s.length + 2));
    });
    col.width = max;
  });
}

function printSetup(ws: any, headerRowNumber: number) {
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${headerRowNumber}:${headerRowNumber}`,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  };
}

/* ------------------------------ gráficos canvas ------------------------------ */

function drawBarChartPng(title: string, bars: ChartBar[]): string | null {
  if (!bars.length) return null;
  const W = 860;
  const H = 400;
  const PAD = { t: 56, r: 24, b: 66, l: 90 };
  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, W / 2, 30);

  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const max = Math.max(...bars.map((b) => b.value), 1);
  const niceMax = niceCeil(max);

  ctx.strokeStyle = '#94A3B8';
  ctx.beginPath();
  ctx.moveTo(PAD.l, PAD.t);
  ctx.lineTo(PAD.l, PAD.t + plotH);
  ctx.lineTo(PAD.l + plotW, PAD.t + plotH);
  ctx.stroke();

  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = (niceMax / 4) * i;
    const y = PAD.t + plotH - (v / niceMax) * plotH;
    ctx.strokeStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(PAD.l + plotW, y);
    ctx.stroke();
    ctx.fillStyle = '#64748B';
    ctx.fillText(shortMoney(v), PAD.l - 8, y + 4);
  }

  const slot = plotW / bars.length;
  const barW = Math.max(6, Math.min(48, slot * 0.6));
  const labelEvery = bars.length > 16 ? Math.ceil(bars.length / 12) : 1;
  bars.forEach((b, i) => {
    const x = PAD.l + slot * i + (slot - barW) / 2;
    const h = (b.value / niceMax) * plotH;
    const y = PAD.t + plotH - h;
    if (b.color) {
      ctx.fillStyle = b.color;
    } else {
      const grad = ctx.createLinearGradient(0, y, 0, PAD.t + plotH);
      grad.addColorStop(0, '#10B981');
      grad.addColorStop(1, '#059669');
      ctx.fillStyle = grad;
    }
    roundRect(ctx, x, y, barW, Math.max(h, b.value > 0 ? 2 : 0), 3);
    ctx.fill();

    if (bars.length <= 24 && b.value > 0) {
      ctx.fillStyle = b.color ? '#991B1B' : '#0F172A';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(shortMoney(b.value), x + barW / 2, y - 5);
    }

    if (i % labelEvery === 0) {
      ctx.save();
      ctx.fillStyle = '#475569';
      ctx.font = '10px sans-serif';
      ctx.textAlign = bars.length > 10 ? 'right' : 'center';
      if (bars.length > 10) {
        ctx.translate(x + barW / 2, PAD.t + plotH + 12);
        ctx.rotate(-Math.PI / 5);
        ctx.fillText(b.label, 0, 0);
      } else {
        ctx.fillText(b.label, x + barW / 2, PAD.t + plotH + 16);
      }
      ctx.restore();
    }
  });

  const total = bars.reduce((a, b) => a + b.value, 0);
  ctx.fillStyle = '#059669';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Total: ${shortMoney(total)}`, W - PAD.r, 30);

  return canvas.toDataURL('image/png').split(',')[1] || null;
}

function drawDonutPng(title: string, bars: ChartBar[]): string | null {
  if (!bars.length) return null;
  const W = 520;
  const H = 340;
  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, W / 2, 26);

  const total = bars.reduce((a, b) => a + b.value, 0) || 1;
  const cx = 150;
  const cy = 185;
  const R = 105;
  const r = 62;
  let angle = -Math.PI / 2;
  bars.forEach((b, i) => {
    const slice = (b.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = b.color || DONUT_COLORS[i % DONUT_COLORS.length];
    ctx.fill();
    angle += slice;
  });
  // Agujero
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Total', cx, cy - 6);
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#059669';
  ctx.fillText(shortMoney(total), cx, cy + 14);

  // Leyenda
  ctx.textAlign = 'left';
  bars.forEach((b, i) => {
    const y = 70 + i * 30;
    ctx.fillStyle = b.color || DONUT_COLORS[i % DONUT_COLORS.length];
    roundRect(ctx, 290, y - 10, 14, 14, 3);
    ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.font = '12px sans-serif';
    ctx.fillText(b.label, 312, y + 1);
    ctx.fillStyle = '#64748B';
    ctx.font = '11px sans-serif';
    const pct = Math.round((b.value / total) * 1000) / 10;
    ctx.fillText(`${shortMoney(b.value)} · ${pct}%`, 312, y + 14);
  });

  return canvas.toDataURL('image/png').split(',')[1] || null;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const n = Math.ceil((v / base) * 2) / 2 * base;
  return n > v ? n : v * 1.1;
}

function shortMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (v >= 10_000) return `$${Math.round(v / 1000)}k`;
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}

/* --------------------------------- hojas ---------------------------------- */

async function addChartSheet(wb: any, sheetName: string, charts: { title: string; bars: ChartBar[] }[]) {
  const usable = charts.filter((c) => c.bars.length > 0);
  if (!usable.length) return;
  const ws = wb.addWorksheet(sheetName);
  ws.properties.tabColor = { argb: 'FFF59E0B' };

  let imageEndRow = 1;
  usable.forEach((c, idx) => {
    const png = drawBarChartPng(c.title, c.bars);
    if (!png) return;
    const imgId = wb.addImage({ base64: png, extension: 'png' });
    const anchorRow = 1 + idx * 22;
    ws.addImage(imgId, { tl: { col: 1, row: anchorRow }, ext: { width: 860, height: 400 }, editAs: 'oneCell' });
    imageEndRow = Math.max(imageEndRow, anchorRow + 21);
  });

  // Tabla de datos consolidada debajo de las imágenes
  const labels: string[] = [];
  for (const c of usable) for (const b of c.bars) if (!labels.includes(b.label)) labels.push(b.label);
  const startRow = imageEndRow + 3;
  const titleRow = ws.getRow(startRow);
  titleRow.getCell(2).value = 'Datos de los gráficos';
  titleRow.getCell(2).font = { bold: true, size: 12, color: { argb: 'FF0F172A' } };
  titleRow.height = 20;
  const header = ws.getRow(startRow + 1);
  header.getCell(2).value = 'Categoría';
  usable.forEach((c, i) => { header.getCell(3 + i).value = c.title.replace(/^[^—]*—\s*/, '') || `Serie ${i + 1}`; });
  styleHeader(header);
  labels.forEach((label, rIdx) => {
    const row = ws.getRow(startRow + 2 + rIdx);
    row.getCell(2).value = label;
    usable.forEach((c, i) => {
      const bar = c.bars.find((b) => b.label === label);
      setMoney(row.getCell(3 + i), bar?.value ?? 0);
    });
    borderRow(row);
  });
  const totalRow = ws.getRow(startRow + 2 + labels.length);
  totalRow.getCell(2).value = 'TOTAL';
  totalRow.getCell(2).font = { bold: true };
  usable.forEach((c, i) => {
    setMoney(totalRow.getCell(3 + i), c.bars.reduce((a, b) => a + b.value, 0));
    totalRow.getCell(3 + i).font = { bold: true };
  });
  borderRow(totalRow);

  // Anchos dinámicos según contenido (encabezado + montos)
  const moneyStr = (v: number) => v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  ws.getColumn(2).width = Math.max(12, 'Categoría'.length + 2, ...labels.map((l) => l.length + 2), 'TOTAL'.length + 2);
  usable.forEach((c, i) => {
    const headerLen = (header.getCell(3 + i).value as string || '').length + 2;
    const moneyLen = Math.max(
      ...c.bars.map((b) => moneyStr(b.value).length + 3),
      moneyStr(c.bars.reduce((a, b) => a + b.value, 0)).length + 3,
      14
    );
    ws.getColumn(3 + i).width = Math.max(headerLen, moneyLen, 12);
  });
}

function groupSum<T>(rows: T[], key: (r: T) => string, val: (r: T) => number, exclude?: (r: T) => boolean) {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (exclude && exclude(r)) continue;
    const k = key(r);
    map.set(k, (map.get(k) || 0) + (Number(val(r)) || 0));
  }
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
}

async function addResumenSheet(
  wb: any,
  periodo: string,
  rows: { total: number; ganancia?: number; anulada: boolean; pago?: string; vendedor: string; cliente?: string; tipo?: string; despacho?: string }[]
) {
  const ws = wb.addWorksheet('Resumen');
  ws.properties.tabColor = { argb: 'FF10B981' };
  const valid = rows.filter((r) => !r.anulada);
  const anuladas = rows.filter((r) => r.anulada);
  const sum = (rs: typeof rows) => rs.reduce((a, r) => a + (Number(r.total) || 0), 0);
  const revenue = sum(valid);
  const profit = valid.reduce((a, r) => a + (Number(r.ganancia) || 0), 0);
  const hasProfit = valid.some((r) => r.ganancia !== undefined);

  const title = ws.addRow(['RESUMEN EJECUTIVO']);
  title.font = { bold: true, size: 16 };
  ws.addRow(['Período', periodo]);
  ws.addRow(['Generado', new Date().toLocaleString('es-AR')]);
  ws.addRow([]);

  const kpiHeader = ws.addRow(['Indicador', 'Valor']);
  styleHeader(kpiHeader);
  const kpis: [string, number | string][] = [
    ['Ventas completadas', valid.length],
    ['Facturación total', revenue],
    ['Ticket promedio', valid.length ? Math.round((revenue / valid.length) * 100) / 100 : 0],
  ];
  if (hasProfit) {
    kpis.push(['Ganancia total', profit]);
    kpis.push(['Margen promedio %', revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0]);
  }
  kpis.push(['Anuladas (cantidad)', anuladas.length]);
  kpis.push(['Anuladas (monto)', sum(anuladas)]);
  for (const [label, v] of kpis) {
    const row = ws.addRow([label, v]);
    borderRow(row);
    if (typeof v === 'number' && label !== 'Ventas completadas' && label !== 'Anuladas (cantidad)' && !label.includes('%')) {
      setMoney(row.getCell(2), v);
    } else if (label.includes('%')) {
      row.getCell(2).numFmt = '0.0"%"';
    }
    if (label.startsWith('Anuladas')) row.font = { color: { argb: 'FFDC2626' } };
    if (label === 'Facturación total') row.font = { bold: true };
  }

  // Medios de pago + donut
  const pagoBars = valid.some((r) => r.pago)
    ? groupSum(valid, (r) => r.pago || 'Otro', (r) => r.total)
    : [];
  if (pagoBars.length) {
    ws.addRow([]);
    const h1 = ws.addRow(['Facturación por medio de pago']);
    h1.font = { bold: true, size: 13 };
    const hp = ws.addRow(['Medio de pago', 'Monto', '% del total']);
    styleHeader(hp);
    pagoBars.forEach((g, i) => {
      const row = ws.addRow([g.label, g.value, revenue > 0 ? Math.round((g.value / revenue) * 1000) / 10 : 0]);
      setMoney(row.getCell(2), g.value);
      row.getCell(3).numFmt = '0.0"%"';
      borderRow(row);
      row.getCell(1).font = { color: { argb: `FF${(DONUT_COLORS[i % DONUT_COLORS.length] || '#64748B').replace('#', '').toUpperCase()}` } };
    });
    const donut = drawDonutPng('Medios de pago', pagoBars.map((b, i) => ({ ...b, color: DONUT_COLORS[i % DONUT_COLORS.length] })));
    if (donut) {
      const imgId = wb.addImage({ base64: donut, extension: 'png' });
      ws.addImage(imgId, { tl: { col: 5, row: 1 }, ext: { width: 520, height: 340 }, editAs: 'oneCell' });
    }
  }

  // Por vendedor
  ws.addRow([]);
  const h2 = ws.addRow(['Facturación por vendedor']);
  h2.font = { bold: true, size: 13 };
  const hv = ws.addRow(['Vendedor', 'Monto', 'Ventas', '% del total']);
  styleHeader(hv);
  const byVendMap = new Map<string, { total: number; count: number }>();
  for (const r of valid) {
    const cur = byVendMap.get(r.vendedor) || { total: 0, count: 0 };
    cur.total += Number(r.total) || 0;
    cur.count += 1;
    byVendMap.set(r.vendedor, cur);
  }
  Array.from(byVendMap.entries())
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.total - a.total)
    .forEach((g) => {
      const row = ws.addRow([g.label, g.total, g.count, revenue > 0 ? Math.round((g.total / revenue) * 1000) / 10 : 0]);
      setMoney(row.getCell(2), g.total);
      row.getCell(4).numFmt = '0.0"%"';
      borderRow(row);
    });

  // Por tipo y despacho
  if (rows.some((r) => r.tipo)) {
    ws.addRow([]);
    const h3 = ws.addRow(['Ventas por tipo de comprobante']);
    h3.font = { bold: true, size: 13 };
    const ht = ws.addRow(['Tipo', 'Monto', 'Ventas']);
    styleHeader(ht);
    const counts = new Map<string, number>();
    for (const r of valid) counts.set(r.tipo || 'Interno', (counts.get(r.tipo || 'Interno') || 0) + 1);
    groupSum(valid, (r) => r.tipo || 'Interno', (r) => r.total).forEach((g) => {
      const row = ws.addRow([g.label, g.value, counts.get(g.label) || 0]);
      setMoney(row.getCell(2), g.value);
      borderRow(row);
    });
  }
  if (rows.some((r) => r.despacho)) {
    ws.addRow([]);
    const h4 = ws.addRow(['Ventas por despacho']);
    h4.font = { bold: true, size: 13 };
    const hd = ws.addRow(['Despacho', 'Monto', 'Ventas']);
    styleHeader(hd);
    const counts = new Map<string, number>();
    for (const r of valid) counts.set(r.despacho || 'Retira', (counts.get(r.despacho || 'Retira') || 0) + 1);
    groupSum(valid, (r) => r.despacho || 'Retira', (r) => r.total).forEach((g) => {
      const row = ws.addRow([g.label, g.value, counts.get(g.label) || 0]);
      setMoney(row.getCell(2), g.value);
      borderRow(row);
    });
  }

  // Top 5 clientes
  const byClient = groupSum(valid, (r) => r.cliente || 'Sin nombre', (r) => r.total).slice(0, 5);
  if (byClient.length) {
    ws.addRow([]);
    const h5 = ws.addRow(['Top 5 clientes']);
    h5.font = { bold: true, size: 13 };
    const hc = ws.addRow(['Cliente', 'Monto', '% del total']);
    styleHeader(hc);
    byClient.forEach((g) => {
      const row = ws.addRow([g.label, g.value, revenue > 0 ? Math.round((g.value / revenue) * 1000) / 10 : 0]);
      setMoney(row.getCell(2), g.value);
      row.getCell(3).numFmt = '0.0"%"';
      borderRow(row);
    });
  }

  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 14;
}

/* -------------------------------- exports ---------------------------------- */

export interface VentaRow {
  ticket: string;
  fecha: string;
  fechaISO?: string;
  cliente: string;
  vendedor: string;
  pago: string;
  despacho?: string;
  tipo?: string;
  cantItems: number;
  detalle?: string;
  total: number;
  ganancia?: number;
  anulada: boolean;
}

/** Historial / Panel → "Exportar": detalle + Resumen + Gráfico. */
export async function exportVentasXlsx(
  prefix: string,
  periodo: string,
  rows: VentaRow[],
  totals: { revenue: number; profit?: number },
  chart?: { title: string; bars: ChartBar[] }
) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ventas');
  ws.properties.tabColor = { argb: 'FF1E293B' };

  const hasDetalle = rows.some((r) => r.detalle);
  const hasGanancia = rows.some((r) => r.ganancia !== undefined);
  const headers = ['Ticket', 'Fecha', 'Cliente', 'Vendedor', 'Pago', 'Despacho', 'Tipo', 'Estado', 'Cant. items'];
  if (hasDetalle) headers.push('Detalle items');
  headers.push('Total');
  if (hasGanancia) headers.push('Ganancia');

  ws.addRow([`Período: ${periodo}`, `Generado: ${new Date().toLocaleString('es-AR')}`]);
  ws.addRow([]);
  const headerRow = ws.addRow(headers);
  styleHeader(headerRow);

  rows.forEach((r, idx) => {
    const cells: any[] = [r.ticket, r.fecha, r.cliente, r.vendedor, r.pago, r.despacho || '', r.tipo || '', r.anulada ? 'Anulada' : 'Completada', r.cantItems];
    if (hasDetalle) cells.push(r.detalle || '');
    const row = ws.addRow(cells);
    setMoney(row.getCell(cells.length + 1), r.total);
    if (hasGanancia) setMoney(row.getCell(cells.length + 2), r.ganancia);
    borderRow(row);
    if (r.anulada) styleCancelRow(row);
    else if (idx % 2 === 1) row.fill = { ...ZEBRA_FILL };
  });

  ws.addRow([]);
  const labelCellCount = headers.length - (hasGanancia ? 2 : 1);
  const totalRow = ws.addRow(Array(labelCellCount).fill('').concat(['TOTAL']));
  const revCell = totalRow.getCell(labelCellCount + 1);
  setMoney(revCell, totals.revenue);
  if (hasGanancia) setMoney(totalRow.getCell(labelCellCount + 2), totals.profit);
  totalRow.font = { bold: true };
  revCell.font = { bold: true };
  borderRow(totalRow);

  ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: headers.length } };
  ws.views = [{ state: 'frozen', ySplit: headerRow.number, xSplit: 1 }];
  printSetup(ws, headerRow.number);

  autoWidth(ws);

  await addResumenSheet(wb, periodo, rows);

  // Gráfico de ganancia por día (auto) además del recibido
  const charts: { title: string; bars: ChartBar[] }[] = [];
  if (chart) charts.push(chart);
  const ganBars = barsByField(rows.filter((r) => !r.anulada && r.fechaISO && r.ganancia !== undefined).map((r) => ({
    created_at: r.fechaISO!,
    value: Number(r.ganancia) || 0,
  })), 'Ganancia por día');
  if (ganBars.length) charts.push({ title: 'Ganancia por día', bars: ganBars });
  await addChartSheet(wb, 'Gráfico', charts);

  await downloadWorkbook(wb, `${prefix}-${stampXlsx()}`);
}

export interface ContadorRowXlsx {
  ticket: string;
  fecha: string;
  cliente: string;
  doc?: string;
  vendedor: string;
  pago: string;
  tipo?: string;
  ivaCond?: string;
  neto?: number;
  iva?: number;
  total: number;
  anulada: boolean;
}

/** Historial / Panel → "Para contador": resumen fiscal + detalle + Resumen + Gráfico. */
export async function exportContadorXlsx(
  prefix: string,
  periodo: string,
  rows: ContadorRowXlsx[],
  chart?: { title: string; bars: ChartBar[] }
) {
  const valid = rows.filter((r) => !r.anulada);
  const anuladas = rows.filter((r) => r.anulada);
  const sum = (rs: ContadorRowXlsx[]) => rs.reduce((a, r) => a + Number(r.total || 0), 0);
  const byPago = (p: string) => sum(valid.filter((r) => r.pago === p));

  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Contador');
  ws.properties.tabColor = { argb: 'FF3B82F6' };

  const t = ws.addRow(['RESUMEN FISCAL']);
  t.font = { bold: true, size: 14 };
  const resumenRows: any[] = [];
  resumenRows.push(ws.addRow(['Período', periodo]));
  resumenRows.push(ws.addRow(['Generado', new Date().toLocaleString('es-AR')]));
  resumenRows.push(ws.addRow(['Ventas completadas', valid.length]));
  const factRow = ws.addRow(['Facturación total']); setMoney(factRow.getCell(2), sum(valid)); factRow.font = { bold: true }; resumenRows.push(factRow);
  resumenRows.push((() => { const r = ws.addRow(['Efectivo']); setMoney(r.getCell(2), byPago('Efectivo')); return r; })());
  resumenRows.push((() => { const r = ws.addRow(['Transferencia']); setMoney(r.getCell(2), byPago('Transferencia')); return r; })());
  resumenRows.push((() => { const r = ws.addRow(['Tarjeta']); setMoney(r.getCell(2), byPago('Tarjeta')); return r; })());
  resumenRows.push((() => { const r = ws.addRow(['Mercado Pago']); setMoney(r.getCell(2), byPago('Mercado Pago')); return r; })());
  resumenRows.push(ws.addRow(['Anuladas (cantidad)', anuladas.length]));
  const anRow = ws.addRow(['Anuladas (monto)']); setMoney(anRow.getCell(2), sum(anuladas)); anRow.font = { color: { argb: 'FFDC2626' } }; resumenRows.push(anRow);
  resumenRows.forEach((r) => borderRow(r));
  ws.addRow([]);

  const det = ws.addRow(['DETALLE']);
  det.font = { bold: true, size: 14 };
  const headerRow = ws.addRow(['Ticket', 'Fecha', 'Cliente', 'CUIT/DNI', 'Vendedor', 'Pago', 'Tipo doc', 'Cond. IVA', 'Neto', 'IVA', 'Estado', 'Total']);
  styleHeader(headerRow);

  rows.forEach((r, idx) => {
    const row = ws.addRow([r.ticket, r.fecha, r.cliente, r.doc || '', r.vendedor, r.pago, r.tipo || '', r.ivaCond || '']);
    setMoney(row.getCell(9), r.neto ?? 0);
    setMoney(row.getCell(10), r.iva ?? 0);
    row.getCell(11).value = r.anulada ? 'Anulada' : 'Completada';
    setMoney(row.getCell(12), r.total);
    borderRow(row);
    if (r.anulada) styleCancelRow(row);
    else if (idx % 2 === 1) row.fill = { ...ZEBRA_FILL };
  });

  ws.addRow([]);
  const totalRow = ws.addRow(['TOTAL', '', '', '', '', '', '', '', '', '', '', '']);
  setMoney(totalRow.getCell(12), sum(valid));
  totalRow.font = { bold: true };
  borderRow(totalRow);

  autoWidth(ws);
  ws.views = [{ state: 'frozen', ySplit: headerRow.number, xSplit: 1 }];
  printSetup(ws, headerRow.number);

  await addResumenSheet(wb, periodo, rows.map((r) => ({
    total: r.total, anulada: r.anulada, pago: r.pago, vendedor: r.vendedor, cliente: r.cliente, tipo: r.tipo,
  })));
  await addChartSheet(wb, 'Gráfico', chart ? [chart] : []);

  await downloadWorkbook(wb, `${prefix}-${stampXlsx()}`);
}

function barsByField(sales: { created_at: string; value: number }[], _title: string): ChartBar[] {
  const map = new Map<string, { t: number; value: number }>();
  for (const s of sales) {
    const d = new Date(s.created_at);
    if (isNaN(d.getTime())) continue;
    const key = d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const cur = map.get(key) || { t: dayStart, value: 0 };
    cur.value += Number(s.value) || 0;
    map.set(key, cur);
  }
  return Array.from(map.entries())
    .map(([label, v]) => ({ label, value: Math.round(v.value * 100) / 100, t: v.t }))
    .sort((a, b) => a.t - b.t)
    .map(({ label, value }) => ({ label, value }));
}

/** Agrupa ventas por día (excluye anuladas) para el gráfico del export. */
export function barsByDay(sales: { created_at: string; total_amount: unknown; status?: string }[]): ChartBar[] {
  return barsByField(
    sales.filter((s) => s.status !== 'cancelled')
      .map((s) => ({ created_at: s.created_at, value: Number(s.total_amount) || 0 })),
    'Ventas por día'
  );
}

/** Agrupa por medio de pago (anuladas en rojo) para el gráfico del contador. */
export function barsByPayment(rows: { pago: string; total: number; anulada: boolean }[]): ChartBar[] {
  const validBars = groupSum(rows, (r) => r.pago, (r) => r.total, (r) => r.anulada);
  const anuladas = rows.filter((r) => r.anulada).reduce((a, r) => a + (Number(r.total) || 0), 0);
  const bars: ChartBar[] = [...validBars];
  if (anuladas > 0) bars.push({ label: 'Anuladas', value: Math.round(anuladas * 100) / 100, color: '#DC2626' });
  return bars;
}

function stampXlsx() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.xlsx`;
}
